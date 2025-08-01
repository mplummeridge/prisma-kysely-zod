import type { GeneratorOptions, DMMF } from "@prisma/generator-helper";
import { generatorHandler } from "@prisma/generator-helper";
import path from "node:path";

import { GENERATOR_NAME } from "~/constants";
import { generateDatabaseType } from "~/helpers/generateDatabaseType";
import { generateFiles } from "~/helpers/generateFiles";
import { generateImplicitManyToManyModels } from "~/helpers/generateImplicitManyToManyModels";
import { generateModel } from "~/helpers/generateModel";
import { sorted } from "~/utils/sorted";
import { validateConfig } from "~/utils/validateConfig";
import { writeFileSafely } from "~/utils/writeFileSafely";

import { type EnumType, generateEnumType } from "./helpers/generateEnumType";
import {
  convertToMultiSchemaModels,
  parseMultiSchemaMap,
} from "./helpers/multiSchemaHelpers";
import { generateZodSchema, type ZodSchemaType } from "./helpers/generateZodSchema";
import { BrandRegistryGenerator } from "./generators/generateBrandRegistry";
import { ThreeLayerSchemaGenerator } from "./generators/generateThreeLayerSchemas";
import { CrudSchemaGenerator } from "./generators/generateCrudSchemas";
import { BrandedTypeMapGenerator } from "./generators/generateBrandedTypeMap";
import { SQLiteBooleanPluginGenerator } from "./generators/generateSQLiteBooleanPlugin";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("../package.json");

generatorHandler({
  onManifest() {
    return {
      version,
      defaultOutput: "./generated",
      prettyName: GENERATOR_NAME,
    };
  },
  onGenerate: async (options: GeneratorOptions) => {
    // Parse the config
    const config = validateConfig({
      ...options.generator.config,
      databaseProvider: options.datasources[0].provider,
    });

    // Generate enum types
    let enums = options.dmmf.datamodel.enums
      .map(({ name, values }: { name: string; values: DMMF.EnumValue[] }) => generateEnumType(name, values))
      .filter((e: EnumType | undefined): e is EnumType => !!e);

    // Generate DMMF models for implicit many to many tables
    //
    // (I don't know why you would want to use implicit tables
    // with kysely, but hey, you do you)
    const implicitManyToManyModels = generateImplicitManyToManyModels(
      options.dmmf.datamodel.models
    );

    const hasMultiSchema = options.datasources.some(
      (d) => d.schemas.length > 0
    );

    const multiSchemaMap =
      config.groupBySchema || hasMultiSchema
        ? parseMultiSchemaMap(options.datamodel)
        : undefined;

    // Generate model types
    let models = sorted(
      [...options.dmmf.datamodel.models, ...implicitManyToManyModels],
      (a, b) => a.name.localeCompare(b.name)
    ).map((m) =>
      generateModel(m, config, {
        groupBySchema: config.groupBySchema,
        defaultSchema: config.defaultSchema,
        multiSchemaMap,
      })
    );

    // Extend model table names with schema names if using multi-schemas
    if (hasMultiSchema) {
      const filterBySchema = config.filterBySchema
        ? new Set(config.filterBySchema)
        : null;

      models = convertToMultiSchemaModels({
        models,
        groupBySchema: config.groupBySchema,
        defaultSchema: config.defaultSchema,
        filterBySchema,
        multiSchemaMap,
      });

      enums = convertToMultiSchemaModels({
        models: enums,
        groupBySchema: config.groupBySchema,
        defaultSchema: config.defaultSchema,
        filterBySchema,
        multiSchemaMap,
      });
    }

    // Generate the database type that ties it all together
    const databaseType = generateDatabaseType(models, config);

    // Generate Zod schemas if enabled
    let zodSchemas: ZodSchemaType[] = [];
    if (config.generateZodSchemas) {
      zodSchemas = sorted(
        [...options.dmmf.datamodel.models, ...implicitManyToManyModels],
        (a, b) => a.name.localeCompare(b.name)
      ).map((m) => generateZodSchema(m, config));
    }

    // Parse it all into a string. Either 1 or 2 files depending on user config
    const files = generateFiles({
      databaseType,
      enumNames: options.dmmf.datamodel.enums.map((e: DMMF.DatamodelEnum) => e.name),
      models,
      enums,
      enumsOutfile: config.enumFileName,
      typesOutfile: config.fileName,
      groupBySchema: config.groupBySchema,
      defaultSchema: config.defaultSchema,
      importExtension: config.importExtension,
      generateZodSchemas: config.generateZodSchemas,
      zodSchemas,
      zodSchemasFileName: config.zodSchemasFileName,
    });

    // And write it to a file!
    await Promise.allSettled(
      files.map(({ filepath, content }) => {
        const writeLocation = path.join(
          options.generator.output?.value || "",
          filepath
        );
        return writeFileSafely(writeLocation, content);
      })
    );

    // Phase 3: Generate Brand Registry if enabled
    if (config.generateBrandRegistry) {
      const brandOutputDir = path.join(
        options.generator.output?.value || "",
        "brands"
      );
      const brandGenerator = new BrandRegistryGenerator(
        options.dmmf,
        brandOutputDir
      );
      await brandGenerator.generate();
    }

    // Phase 4: Generate Three-Layer Schemas if enabled
    if (config.generateThreeLayers) {
      const layersOutputDir = path.join(
        options.generator.output?.value || "",
        "layers"
      );
      const brandRegistryPath = config.generateBrandRegistry
        ? "../brands"
        : undefined;
      
      const layerGenerator = new ThreeLayerSchemaGenerator(
        options.dmmf,
        layersOutputDir,
        brandRegistryPath,
        config
      );
      await layerGenerator.generate();
    }

    // Phase 5: Generate Branded Type Map
    // This is always generated when we have Zod schemas
    if (config.generateZodSchemas) {
      const typeMapGenerator = new BrandedTypeMapGenerator(
        options.dmmf,
        options.generator.output?.value || ""
      );
      await typeMapGenerator.generate();
    }

    // Phase 6: Generate CRUD Schemas if enabled
    if (config.generateCrudSchemas) {
      const crudOutputDir = path.join(
        options.generator.output?.value || "",
        config.crudConfig?.outputDir || "crud"
      );
      
      const crudGenerator = new CrudSchemaGenerator(
        options.dmmf,
        crudOutputDir,
        config,
        config.crudConfig
      );
      await crudGenerator.generate();
    }
  },
});
