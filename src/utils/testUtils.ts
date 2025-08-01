import ts, { createPrinter } from "typescript";
import type { Config } from "./validateConfig";

export const stringifyTsNode = (node: ts.Node) => {
  return createPrinter().printNode(
    ts.EmitHint.Unspecified,
    node,
    ts.factory.createSourceFile(
      [],
      ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None
    )
  );
};

export const createTestConfig = (overrides?: Partial<Config>): Config => {
  return {
    databaseProvider: "sqlite",
    fileName: "types.ts",
    enumFileName: "types.ts",
    importExtension: "",
    camelCase: false,
    readOnlyIds: false,
    groupBySchema: false,
    defaultSchema: "public",
    dbTypeName: "DB",
    generateZodSchemas: false,
    useDefaultValidators: true,
    generateBrandRegistry: false,
    generateThreeLayers: false,
    generateCrudSchemas: false,
    generateSQLiteBooleanPlugin: false,
    ...overrides,
  };
};
