# Testing Zod Generation in my-react-router-app

## Quick Test Instructions

### 1. Update package.json to use local fork

In your `my-react-router-app/package.json`, replace the prisma-kysely dependency:

```json
"@arthurfiorette/prisma-kysely": "file:../prisma-kysely"
```

### 2. Install the local dependency

```bash
npm install
```

### 3. Update your Prisma schema

Add or update the kysely generator in your Prisma schema files to enable Zod generation:

```prisma
generator kysely {
  provider = "prisma-kysely"
  output = "../generated/kysely"
  fileName = "types.ts"
  
  // Add this line to enable Zod generation
  generateZodSchemas = "true"
  
  // Optional: specify a different filename for Zod schemas
  // zodSchemasFileName = "schemas.ts"
}
```

### 4. Generate the types

```bash
npm run typegen:db
```

### 5. Verify the output

Check the output directory (e.g., `prisma/generated/kysely/`) for:
- `types.ts` - Your existing Kysely types
- `schemas.ts` - New Zod schemas!

### 6. Example usage

```typescript
import { MessageSchema, UserSchema } from '#prisma/generated/kysely/schemas';

// Validate data from database
const rawMessage = await db.selectFrom('Message').selectAll().executeTakeFirst();
const validatedMessage = MessageSchema.parse(rawMessage);

// Use for runtime validation
const createMessage = (input: unknown) => {
  const validated = MessageSchema.parse(input);
  // ... use validated data
};
```

## What to Look For

1. **File Generation**: A `schemas.ts` file should be created alongside your `types.ts`
2. **Imports**: The file should import `{ z } from "zod"`
3. **Schemas**: Each model should have a corresponding schema (e.g., `UserSchema`, `MessageSchema`)
4. **Type Mappings**: Check that types match your database:
   - SQLite: `Boolean` → `z.number()`, `DateTime` → `z.string()`
   - PostgreSQL: `Boolean` → `z.boolean()`, `DateTime` → `z.coerce.date()`
5. **@kyselyType Support**: Fields with `@kyselyType` should have `.transform()` for JSON parsing

## Troubleshooting

- If no schemas.ts file appears, check that `generateZodSchemas = "true"` is in your Prisma schema
- Run `npx prisma-kysely` directly to see any error messages
- Check that you're using the local fork (not the npm version) with `npm ls @arthurfiorette/prisma-kysely`