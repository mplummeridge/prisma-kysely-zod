/**
 * Test script for Phase 3: Brand Registry extraction
 */

import { BrandRegistryGenerator } from "../src/generators/generateBrandRegistry";
import { DMMF } from "@prisma/generator-helper";
import path from "path";
import { readFile } from "fs-extra";

// Mock DMMF structure with brand annotations
const mockDMMF: DMMF.Document = {
  datamodel: {
    models: [
      {
        name: "User",
        fields: [
          {
            name: "id",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Unique identifier for the user\n@zod.cuid().brand(\"UserId\")"
          },
          {
            name: "email",
            type: "String", 
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "User's email address\n@zod.email().toLowerCase()"
          },
          {
            name: "name",
            type: "String",
            kind: "scalar", 
            isList: false,
            isRequired: false,
            documentation: "User's display name\n@zod.min(2).max(50).trim()"
          }
        ]
      },
      {
        name: "Post",
        fields: [
          {
            name: "id",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Unique post identifier\n@zod.cuid().brand(\"PostId\")"
          },
          {
            name: "authorId",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Author of the post\n@zod.cuid().brand(\"UserId\")"
          },
          {
            name: "views",
            type: "Int",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "View counter\n@zod.int().nonnegative()"
          }
        ]
      },
      {
        name: "Comment",
        fields: [
          {
            name: "id", 
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Unique comment identifier\n@zod.cuid().brand(\"CommentId\")"
          },
          {
            name: "postId",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Parent post\n@zod.cuid().brand(\"PostId\")"
          },
          {
            name: "authorId",
            type: "String",
            kind: "scalar",
            isList: false,
            isRequired: true,
            documentation: "Comment author\n@zod.cuid().brand(\"UserId\")"
          }
        ]
      }
    ],
    enums: []
  }
} as DMMF.Document;

async function testBrandExtraction() {
  console.log("Testing Brand Registry Generator...\n");

  const outputDir = path.join(__dirname, "output", "brands");
  const generator = new BrandRegistryGenerator(mockDMMF, outputDir);

  try {
    await generator.generate();
    console.log("✅ Brand registry generated successfully!");

    // Read and display the generated file
    const brandedPath = path.join(outputDir, "branded.ts");
    const content = await readFile(brandedPath, "utf-8");
    
    console.log("\n📄 Generated branded.ts:");
    console.log("=" * 50);
    console.log(content);
    console.log("=" * 50);

    // Verify expected brands
    const expectedBrands = ["UserId", "PostId", "CommentId"];
    let allFound = true;

    console.log("\n🔍 Verifying brands:");
    for (const brand of expectedBrands) {
      if (content.includes(`export const ${brand} =`)) {
        console.log(`✅ Found brand: ${brand}`);
      } else {
        console.log(`❌ Missing brand: ${brand}`);
        allFound = false;
      }
    }

    // Check for duplicates handled correctly
    const userIdCount = (content.match(/export const UserId =/g) || []).length;
    if (userIdCount === 1) {
      console.log("✅ Duplicate UserId brands deduplicated correctly");
    } else {
      console.log(`❌ UserId found ${userIdCount} times (expected 1)`);
      allFound = false;
    }

    // Check utility types
    if (content.includes("export type Brand<T>")) {
      console.log("✅ Brand utility type found");
    } else {
      console.log("❌ Brand utility type missing");
      allFound = false;
    }

    if (content.includes("export type BrandName =")) {
      console.log("✅ BrandName union type found");
    } else {
      console.log("❌ BrandName union type missing");
      allFound = false;
    }

    console.log("\n" + (allFound ? "✅ All tests passed!" : "❌ Some tests failed"));

  } catch (error) {
    console.error("❌ Error generating brand registry:", error);
  }
}

// Run the test
testBrandExtraction().catch(console.error);