/**
 * Standalone test for Phase 3 (Brand Registry) and Phase 4 (Three-Layer Architecture)
 * This tests the generators directly without requiring full compilation
 */

import { DMMF } from "@prisma/generator-helper";
import { BrandRegistryGenerator } from "../src/generators/generateBrandRegistry";
import { ThreeLayerSchemaGenerator } from "../src/generators/generateThreeLayerSchemas";
import path from "path";
import { readFile, existsSync } from "fs-extra";

// Test with a minimal Prisma schema
const testDMMF: DMMF.Document = {
  datamodel: {
    models: [
      {
        name: "User",
        dbName: "user",
        fields: [
          {
            name: "id",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            isUnique: true,
            isId: true,
            documentation: "Unique user identifier\n@zod.cuid().brand(\"UserId\")",
            hasDefaultValue: true,
            default: { name: "cuid", args: [] }
          },
          {
            name: "email",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            isUnique: true,
            documentation: "User email\n@zod.email()"
          },
          {
            name: "verified",
            type: "Boolean",
            kind: "scalar",
            isList: false,
            isRequired: true,
            hasDefaultValue: true,
            default: false
          },
          {
            name: "createdAt",
            type: "DateTime",
            kind: "scalar",
            isList: false,
            isRequired: true,
            hasDefaultValue: true,
            default: { name: "now", args: [] }
          }
        ],
        primaryKey: null,
        uniqueIndexes: [],
        uniqueFields: []
      },
      {
        name: "Post",
        dbName: "post",
        fields: [
          {
            name: "id",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            isUnique: true,
            isId: true,
            documentation: "Post identifier\n@zod.cuid().brand(\"PostId\")",
            hasDefaultValue: true,
            default: { name: "cuid", args: [] }
          },
          {
            name: "authorId",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Author ID\n@zod.cuid().brand(\"UserId\")"
          },
          {
            name: "title",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Post title\n@zod.min(5).max(200)"
          },
          {
            name: "views",
            type: "Int",
            kind: "scalar",
            isList: false,
            isRequired: true,
            hasDefaultValue: true,
            default: 0,
            documentation: "View count\n@zod.int().nonnegative()"
          }
        ],
        primaryKey: null,
        uniqueIndexes: [],
        uniqueFields: []
      }
    ],
    enums: []
  }
} as DMMF.Document;

async function testPhases() {
  console.log("🧪 Testing Phase 3 & 4 Implementation\n");

  const outputBase = path.join(__dirname, "output");

  // Test Phase 3: Brand Registry
  console.log("📦 Phase 3: Testing Brand Registry Generator...");
  const brandOutputDir = path.join(outputBase, "brands");
  const brandGenerator = new BrandRegistryGenerator(testDMMF, brandOutputDir);
  
  try {
    await brandGenerator.generate();
    console.log("✅ Brand registry generated successfully!");

    // Check generated files
    const brandedPath = path.join(brandOutputDir, "branded.ts");
    if (existsSync(brandedPath)) {
      const content = await readFile(brandedPath, "utf-8");
      console.log("\n📄 Generated branded.ts (first 500 chars):");
      console.log("─".repeat(50));
      console.log(content.substring(0, 500) + "...");
      console.log("─".repeat(50));

      // Verify brands
      const expectedBrands = ["UserId", "PostId"];
      const foundBrands = expectedBrands.filter(brand => 
        content.includes(`export const ${brand} =`)
      );
      console.log(`\n✅ Found ${foundBrands.length}/${expectedBrands.length} expected brands: ${foundBrands.join(", ")}`);
    }
  } catch (error) {
    console.error("❌ Brand registry generation failed:", error);
  }

  // Test Phase 4: Three-Layer Architecture
  console.log("\n\n📦 Phase 4: Testing Three-Layer Schema Generator...");
  const layersOutputDir = path.join(outputBase, "layers");
  const layerGenerator = new ThreeLayerSchemaGenerator(
    testDMMF, 
    layersOutputDir,
    "../brands" // Reference to brand registry
  );

  try {
    await layerGenerator.generate();
    console.log("✅ Three-layer schemas generated successfully!");

    // Check generated files
    const userSchemaPath = path.join(layersOutputDir, "user.schemas.ts");
    if (existsSync(userSchemaPath)) {
      const content = await readFile(userSchemaPath, "utf-8");
      console.log("\n📄 Generated user.schemas.ts (first 500 chars):");
      console.log("─".repeat(50));
      console.log(content.substring(0, 500) + "...");
      console.log("─".repeat(50));

      // Verify layers
      const expectedSchemas = ["UserDBSchema", "UserRuntimeSchema", "UserAPISchema"];
      const foundSchemas = expectedSchemas.filter(schema => 
        content.includes(`export const ${schema} =`)
      );
      console.log(`\n✅ Found ${foundSchemas.length}/${expectedSchemas.length} expected schemas: ${foundSchemas.join(", ")}`);

      // Verify transformations
      const expectedTransforms = ["UserDBToRuntime", "UserRuntimeToAPI", "UserDBToAPI"];
      const foundTransforms = expectedTransforms.filter(transform => 
        content.includes(`export const ${transform} =`)
      );
      console.log(`✅ Found ${foundTransforms.length}/${expectedTransforms.length} expected transforms: ${foundTransforms.join(", ")}`);
    }

    // Check transform utils
    const utilsPath = path.join(layersOutputDir, "transform-utils.ts");
    if (existsSync(utilsPath)) {
      console.log("\n✅ Transform utilities generated successfully!");
    }
  } catch (error) {
    console.error("❌ Three-layer generation failed:", error);
  }

  console.log("\n\n🎉 Testing complete!");
}

// Run the test
testPhases().catch(console.error);