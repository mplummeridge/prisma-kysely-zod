# Prisma Kysely Zod

<p align="center">
<a href="https://www.npmjs.com/package/prisma-kysely-zod"><img src="https://badge.fury.io/js/prisma-kysely-zod.svg"></a>
</p>

<br/>

> 🚧 **Library in active development**

**Prisma Kysely Zod** extends the original `prisma-kysely` generator to provide comprehensive Zod schema generation alongside Kysely types. Generate type-safe database queries AND runtime validation schemas from your Prisma schema in one go!

Do you like Prisma's migration flow, schema language and DX but want more control over your queries? Do you need runtime validation for your database types? Do you want to harness the raw power of SQL without losing type safety?

**Enter `prisma-kysely-zod`**!

This generator creates:
- 🚀 Kysely types for type-safe SQL queries
- ✅ Zod schemas for runtime validation
- 🎯 CRUD operation schemas (create, update, findMany)
- 🏗️ Three-layer architecture schemas
- 🔖 Branded types for enhanced type safety

### Setup

1. Install `prisma-kysely-zod` using your package manager of choice:

   ```sh
   npm install prisma-kysely-zod
   # or
   yarn add prisma-kysely-zod
   # or
   pnpm add prisma-kysely-zod
   ```

2. Replace (or augment) the default client generator in your `schema.prisma`
   file with the following:

   ```prisma
   generator kysely {
       provider = "prisma-kysely-zod"

       // Optionally provide a destination directory for the generated file
       // and a filename of your choice
       output = "../src/db"
       fileName = "types.ts"
       // Optionally generate runtime enums to a separate file
       enumFileName = "enums.ts"
       
       // Zod-specific options
       generateBrands = true
       generateCrudSchemas = true
       generateThreeLayerSchemas = true
   }
   ```

3. Run `prisma migrate dev` or `prisma generate` and use your freshly generated
   types and schemas!

   ```typescript
   import { DB } from './db/types'
   import { UserCreateSchema, UserUpdateSchema } from './db/schemas'
   import { Kysely } from 'kysely'

   // Use Kysely for queries
   const db = new Kysely<DB>({ ... })
   const users = await db.selectFrom('User').selectAll().execute()

   // Use Zod schemas for validation
   const newUser = UserCreateSchema.parse(req.body)
   const updatedUser = UserUpdateSchema.parse(req.body)
   ```

### Motivation

Prisma's migration and schema definition workflow is undeniably great, but developers often need:

1. **More control over SQL queries** - Sometimes you need complex joins, CTEs, or database-specific features
2. **Runtime validation** - TypeScript types are great, but you need runtime validation for user input
3. **Different schemas for different operations** - Create, update, and query operations often need different validation rules

**Prisma Kysely Zod** solves all three problems:

✨ **Kysely Integration**: Write type-safe SQL with full control while keeping Prisma's excellent migration workflow

✅ **Zod Schemas**: Automatically generated validation schemas that match your database types exactly

🏗️ **Architecture Support**: Generate schemas tailored for three-layer architecture patterns

🔖 **Branded Types**: Optional branded types for extra type safety (e.g., `UserId` instead of just `string`)

This generator builds upon the excellent `prisma-kysely` package, extending it with comprehensive Zod schema generation for a complete type-safe database solution.

### Config

#### Kysely Options (from original prisma-kysely)

| Key                      | Description                                                                                                                                                                                                                                                                                                                                                                         | Default    |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `output`                 | The directory where generated code will be saved                                                                                                                                                                                                                                                                                                                                    |            |
| `fileName`               | The filename for the generated file                                                                                                                                                                                                                                                                                                                                                 | `types.ts` |
| `importExtension`        | The extension to append to imports. E.g: `".js"` or `".ts"`. Use `""` to append nothing.                                                                                                                                                                                                                                                                                            | `""`       |
| `enumFileName`           | The filename for the generated enums. Omitting this will generate enums and files in the same file.                                                                                                                                                                                                                                                                                 |            |
| `camelCase`              | Enable support for Kysely's camelCase plugin                                                                                                                                                                                                                                                                                                                                        | `false`    |
| `readOnlyIds`            | Use Kysely's `GeneratedAlways` for `@id` fields with default values, preventing insert and update.                                                                                                                                                                                                                                                                                  | `false`    |
| `[typename]TypeOverride` | Allows you to override the resulting TypeScript type for any Prisma type.                                                                                                                                                                                                                                                                                                          |            |
| `dbTypeName`             | Allows you to override the exported type with all tables                                                                                                                                                                                                                                                                                                                            | `DB`       |
| `groupBySchema`          | When using `multiSchema` preview features, group all models and enums for a schema into their own namespace.                                                                                                                                                                                                                                                                        | `false`    |
| `filterBySchema`         | When using `multiSchema` preview features, only include models and enums for the specified schema.                                                                                                                                                                                                                                                                                  | `false`    |
| `defaultSchema`          | When using `multiSchema` preview features, which schema should not be wrapped by a namespace.                                                                                                                                                                                                                                                                                       | `'public'` |

#### Zod-Specific Options

| Key                         | Description                                                                                                     | Default    |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------- | ---------- |
| `generateBrands`            | Generate branded types (e.g., `UserId` instead of `string`)                                                    | `false`    |
| `generateCrudSchemas`       | Generate Create, Update, and FindMany schemas for each model                                                   | `false`    |
| `generateThreeLayerSchemas` | Generate schemas optimized for three-layer architecture (API, Service, Repository layers)                      | `false`    |
| `brandedTypesFile`          | Custom filename for branded types                                                                              | `brands.ts`|
| `crudSchemasFile`           | Custom filename for CRUD schemas                                                                               | `crud.ts`  |
| `threeLayerFile`            | Custom filename for three-layer schemas                                                                        | `layers.ts`|

### Zod Schema Features

#### CRUD Schemas

When `generateCrudSchemas` is enabled, the generator creates specialized schemas for different operations:

```typescript
// UserCreateSchema - for creating new users
const newUser = UserCreateSchema.parse({
  name: "John Doe",
  email: "john@example.com"
})

// UserUpdateSchema - for updating users (all fields optional)
const updates = UserUpdateSchema.parse({
  name: "Jane Doe"
})

// UserFindManySchema - for query parameters
const query = UserFindManySchema.parse({
  where: { email: { contains: "@example.com" } },
  orderBy: { createdAt: "desc" },
  take: 10
})
```

#### Three-Layer Architecture Schemas

Perfect for clean architecture patterns with distinct API, Service, and Repository layers:

```typescript
// API Layer - includes all fields
const apiUser = UserAPISchema.parse(req.body)

// Service Layer - excludes generated fields like timestamps
const serviceUser = UserServiceSchema.parse(data)

// Repository Layer - for database operations
const repoUser = UserRepositorySchema.parse(dbResult)
```

#### Branded Types

Enhance type safety with branded types:

```typescript
// Instead of string IDs everywhere
type UserId = Brand<string, "UserId">
type PostId = Brand<string, "PostId">

// Prevents mixing up IDs
function getUser(id: UserId) { /* ... */ }
function getPost(id: PostId) { /* ... */ }

// TypeScript will catch this error!
const userId: UserId = "123" as UserId
getPost(userId) // Error: Argument of type 'UserId' is not assignable to parameter of type 'PostId'
```

### Per-field type overrides

In some cases, you might want to override a type for a specific field. This
could be useful, for example, for constraining string types to certain literal
values. Be aware though that this does not of course come with any runtime
validation, and in most cases won't be guaranteed to match the actual data in
the database.

That disclaimer aside, here's how it works: Add a `@kyselyType(...)` declaration
to the Prisma docstring (deliniated using three slashes `///`) for the field
with your type inside the parentheses.

```prisma
model User {
  id          String @id
  name        String

  /// @kyselyType('member' | 'admin')
  role        String
}
```

The parentheses can include any valid TS type declaration.

The output for the example above would be as follows:

```ts
export type User = {
  id: string;
  name: string;
  role: "member" | "owner";
};
```

### Gotchas

#### Default values

By default (no pun intended) the Prisma Query Engine uses JS based
implementations for certain default values, namely: `uuid()` and `cuid()`. This
means that they don't end up getting defined as default values on the database
level, and end up being pretty useless for us.

Prisma does provide a nice solution to this though, in the form of
`dbgenerated()`. This allows us to use any valid default value expression that
our database supports:

```prisma
model PostgresUser {
   id    String @id @default(dbgenerated("gen_random_uuid()"))
}

model SQLiteUser {
   id    String @id @default(dbgenerated("(uuid())"))
}
```

[Check out the Prisma Docs for more
info.](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#attribute-functions)

### Zod Annotations

Enhance your Prisma schema with Zod-specific validations using comments:

```prisma
model User {
  id      String @id @default(cuid())
  
  /// @zod.min(3).max(100)
  name    String
  
  /// @zod.email()
  email   String @unique
  
  /// @zod.min(18).max(120)
  age     Int
  
  /// @zod.url().optional()
  website String?
  
  /// @zod.custom(z => z.regex(/^[A-Z]{2}[0-9]{4}$/))
  code    String
}
```

These annotations are parsed and included in the generated Zod schemas, giving you runtime validation that matches your database constraints.

### Contributions

Contributions are welcome! This project builds upon the excellent work of the original `prisma-kysely` package.

1. Fork and clone the repository
2. Run `pnpm install` and `pnpm dev` to start development
3. Make changes to the source code
4. Test your changes by creating `prisma/schema.prisma` and running `pnpm prisma generate`
5. Create a pull request with your improvements

Areas that could use contributions:
- Additional Zod validations and transformations
- Support for more Prisma features
- Performance optimizations
- Documentation improvements

### Credits

This project extends the excellent [prisma-kysely](https://github.com/arthurfiorette/prisma-kysely) generator with Zod schema generation capabilities.

**Original prisma-kysely created by:**
- Valtyr Örn Kjartansson ([@valtyr](https://github.com/valtyr))
- And all the amazing contributors to the original project

**Special thanks to:**
- The Kysely team for the incredible SQL query builder
- The Zod team for the best TypeScript schema validation library
- The Prisma team for their fantastic migration and schema tools

### License

MIT - See LICENSE file for details
