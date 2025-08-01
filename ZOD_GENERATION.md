# Zod Schema Generation for prisma-kysely

This fork of prisma-kysely adds the ability to generate Zod schemas alongside Kysely types from your Prisma schema.

## Features

- Generates Zod schemas that match your Kysely types exactly
- Respects database-specific type mappings (e.g., SQLite stores booleans as numbers)
- Handles `@kyselyType` annotations with proper JSON parsing
- Preserves JSDoc comments from Prisma schemas
- Supports nullable fields, arrays, and enums

## Configuration

Add the following to your Prisma schema:

```prisma
generator kysely {
  provider = "prisma-kysely"
  output = "./generated/kysely"
  fileName = "types.ts"
  
  // Enable Zod schema generation
  generateZodSchemas = "true"
  
  // Optional: specify a separate file for Zod schemas
  // If not specified, schemas will be in a file named "schemas.ts"
  zodSchemasFileName = "schemas.ts"
}
```

## Example

Given this Prisma schema:

```prisma
model User {
  /// Unique identifier
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  verified  Boolean  @default(false)
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  
  /// @kyselyType(import('#shared/zod/user-metadata').UserMetadata)
  metadata  Json?
}

enum Role {
  USER
  ADMIN
}
```

The generator will create:

### Kysely Types (types.ts)
```typescript
export type User = {
  /**
   * Unique identifier
   */
  id: string;
  email: string;
  name: string | null;
  verified: number; // SQLite stores boolean as 0/1
  role: Role;
  createdAt: string; // SQLite stores DateTime as string
  metadata: string | null;
};
```

### Zod Schemas (schemas.ts)
```typescript
import { z } from "zod";
import { Role } from "./types";
import { UserMetadataSchema } from "#shared/zod/user-metadata";

/**
 * Unique identifier
 */
export const UserSchema = z.object({
  /**
   * Unique identifier
   */
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  verified: z.number(), // Matches SQLite storage
  role: z.nativeEnum(Role),
  createdAt: z.string(), // Matches SQLite storage
  metadata: z.string().transform(str => UserMetadataSchema.parse(JSON.parse(str))).nullable(),
});

export type User = z.infer<typeof UserSchema>;
```

## Database-Specific Type Mappings

The Zod schemas validate what the database actually returns:

### SQLite
- `Boolean` → `z.number()` (0 or 1)
- `DateTime` → `z.string()`
- `BigInt` → `z.number()`
- `Decimal` → `z.number()`

### PostgreSQL
- `Boolean` → `z.boolean()`
- `DateTime` → `z.coerce.date()`
- `BigInt` → `z.string()`
- `Decimal` → `z.string()`

### MySQL
- `Boolean` → `z.number()` (tinyint)
- `DateTime` → `z.coerce.date()`
- `BigInt` → `z.number()`
- `Decimal` → `z.string()`

## @kyselyType Support

Fields with `@kyselyType` annotations are handled specially:

```prisma
/// @kyselyType(import('./types').CustomType)
customField String
```

Generates:

```typescript
customField: z.string().transform(str => CustomTypeSchema.parse(JSON.parse(str)))
```

This ensures that JSON fields are properly parsed and validated using the corresponding Zod schema.

## Usage

```typescript
import { db } from './db';
import { UserSchema } from './generated/kysely/schemas';

// Validate data from database
const users = await db.selectFrom('user').selectAll().execute();
const validatedUsers = users.map(user => UserSchema.parse(user));

// Runtime validation for API inputs
const createUser = (input: unknown) => {
  const validated = UserSchema.parse(input);
  return db.insertInto('user').values(validated).execute();
};
```