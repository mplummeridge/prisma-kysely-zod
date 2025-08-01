# Phases 3 & 4 Implementation Plan

## Phase 3: Brand Registry

### Overview
Generate a centralized registry of branded types from Prisma `@zod.brand()` annotations. This creates nominal types for IDs and other values that need type-level distinction.

### Implementation Steps

1. **Parse Brand Annotations**
   - Scan all Prisma models for `@zod.xxx().brand("BrandName")` patterns
   - Extract brand name, base type, and validation chain
   - Track which model/field uses each brand

2. **Generate Brand Registry (`brands/branded.ts`)**
   ```typescript
   export const UserId = z.string().cuid().brand("UserId");
   export type UserId = z.infer<typeof UserId>;
   
   export const PostId = z.string().cuid().brand("PostId");
   export type PostId = z.infer<typeof PostId>;
   ```

3. **Generate Utility Types**
   - `Brand<T>` - Extract brand from a type
   - `BrandName` - Union of all brand names
   - Re-export helpers for brand checking

4. **Integration with Base Schemas**
   - Import brands in generated schemas
   - Use branded types instead of primitives for marked fields

### Example Input/Output

**Input (Prisma schema):**
```prisma
model User {
  /// @zod.cuid().brand("UserId")
  id String @id @default(cuid())
  
  /// @zod.cuid().brand("PostId")
  favoritePostId String?
}
```

**Output (brands/branded.ts):**
```typescript
export const UserId = z.string().cuid().brand("UserId");
export type UserId = z.infer<typeof UserId>;

export const PostId = z.string().cuid().brand("PostId");
export type PostId = z.infer<typeof PostId>;
```

## Phase 4: Three-Layer Architecture

### Overview
Generate three schema layers with automatic transformations between them using `z.pipe()`:
- **Database Layer**: Raw types as stored (dates as strings, booleans as 0/1)
- **Runtime Layer**: Parsed types for app use (Date objects, true/false)
- **API Layer**: JSON-serializable types (ISO strings, no BigInt)

### Implementation Steps

1. **Generate Layer Schemas**
   For each model, create three schemas:
   ```typescript
   // Database layer - matches SQLite storage
   export const UserDBSchema = z.object({
     id: z.string(),
     verified: z.number(), // 0 or 1
     createdAt: z.string(), // ISO string
   });
   
   // Runtime layer - parsed for app use
   export const UserRuntimeSchema = z.object({
     id: brands.UserId, // Branded type
     verified: z.boolean(),
     createdAt: z.date(),
   });
   
   // API layer - JSON-safe types
   export const UserAPISchema = z.object({
     id: z.string(),
     verified: z.boolean(),
     createdAt: z.string().datetime(),
   });
   ```

2. **Create Transformation Pipelines**
   ```typescript
   // Automatic transformations
   export const UserDBToRuntime = UserDBSchema.pipe(UserRuntimeSchema);
   export const UserRuntimeToAPI = UserRuntimeSchema.pipe(UserAPISchema);
   export const UserDBToAPI = UserDBSchema
     .pipe(UserRuntimeSchema)
     .pipe(UserAPISchema);
   ```

3. **Generate Transform Utilities**
   ```typescript
   // Reusable transformers
   export const sqliteBoolean = z.number()
     .transform(val => val === 1)
     .pipe(z.boolean());
   
   export const sqliteDateTime = z.string()
     .transform(val => new Date(val))
     .pipe(z.date());
   ```

### Database-Specific Mappings

**SQLite:**
- Boolean → number (0/1)
- DateTime → string
- BigInt → number
- Decimal → number

**PostgreSQL:**
- Boolean → boolean
- DateTime → Date (coerced)
- BigInt → string
- Decimal → string

**MySQL:**
- Boolean → number (tinyint)
- DateTime → Date (coerced)
- BigInt → number
- Decimal → string

### Usage Example

```typescript
// Fetch from database
const userRow = await db.selectFrom('user').selectAll().executeTakeFirst();

// Transform through layers
const user = UserDBToRuntime.parse(userRow); // Runtime object with Date, boolean
const apiUser = UserRuntimeToAPI.parse(user); // API-safe with ISO strings

// Or direct DB to API
const apiResponse = UserDBToAPI.parse(userRow);
```

## Configuration

Add to Prisma schema:
```prisma
generator kysely {
  provider = "prisma-kysely"
  
  // Phase 2
  generateZodSchemas = "true"
  
  // Phase 3
  generateBrandRegistry = "true"
  
  // Phase 4
  generateThreeLayers = "true"
}
```

## Benefits

1. **Type Safety**: Branded types prevent ID mixups at compile time
2. **Automatic Transformations**: No manual parsing of dates/booleans
3. **Layer Separation**: Clear boundaries between storage, runtime, and API
4. **Reusability**: Transform utilities work across all models
5. **Performance**: `z.pipe()` chains are optimized by Zod

## Next Steps

1. Implement parser enhancements for brand extraction
2. Add configuration options for layer customization
3. Generate tests for transformations
4. Create migration guide from existing schemas