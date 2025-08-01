export interface ZodAnnotation {
  validators: string[];
  customErrors?: Record<string, string>;
  imports?: string[];
  brand?: string;
  description?: string;
}

/**
 * Parse @zod annotations from Prisma field documentation
 * Supports:
 * - Simple validators: @zod.string.email()
 * - Chained validators: @zod.number.min(18).max(100)
 * - Custom error messages: @zod.string.email({ message: "Invalid email" })
 * - Regex validators: @zod.string.regex(/pattern/, "error message")
 */
export const parseZodAnnotations = (documentation?: string): ZodAnnotation | null => {
  if (!documentation) return null;
  
  // Match @zod annotations - try both with and without leading slashes
  let zodMatch = documentation.match(/\/\/\/ @zod\.(.+)/);
  if (!zodMatch) {
    // Try without the leading slashes in case Prisma strips them
    zodMatch = documentation.match(/@zod\.(.+)/);
    if (!zodMatch) return null;
  }
  
  const annotation = zodMatch[1].trim();
  const result: ZodAnnotation = {
    validators: [],
    customErrors: {},
    imports: []
  };
  
  // Parse the annotation string
  // Handle regex patterns specially to avoid splitting them
  const parts: string[] = [];
  let current = '';
  let inRegex = false;
  let parenDepth = 0;
  
  for (let i = 0; i < annotation.length; i++) {
    const char = annotation[i];
    
    if (char === '/' && annotation[i - 1] !== '\\') {
      inRegex = !inRegex;
    }
    
    if (!inRegex) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      
      if (char === '.' && parenDepth === 0) {
        if (current) parts.push(current);
        current = '';
        continue;
      }
    }
    
    current += char;
  }
  
  if (current) parts.push(current);
  
  // Check if this is a Zod v4 top-level validator (no type prefix)
  const isTopLevelValidator = parts.length > 0 && 
    /^(email|url|uuid|cuid|cuid2|ulid|emoji|base64|ipv4|ipv6|datetime|date)$/.test(parts[0]);
  
  // Process each part
  parts.forEach((part, index) => {
    // Skip the type prefix (string, number, etc.) unless it's a top-level validator
    if (index === 0 && !isTopLevelValidator && /^(string|number|boolean|date|bigint|array|object)$/.test(part)) {
      return;
    }
    
    // Parse validator with arguments
    const validatorMatch = part.match(/^(\w+)(?:\((.*)\))?$/);
    if (!validatorMatch) {
      result.validators.push(part); // Fallback to raw string
      return;
    }
    
    const [, validatorName, args] = validatorMatch;
    
    // Special handling for brand
    if (validatorName === 'brand') {
      // Extract the brand name from quotes
      const brandMatch = args?.match(/["']([^"']+)["']/);
      if (brandMatch) {
        result.brand = brandMatch[1];
        result.validators.push(`.brand("${brandMatch[1]}")`);
      }
      return;
    }
    
    // Special handling for describe
    if (validatorName === 'describe') {
      // Extract the description from quotes
      // Handle cases like .describe("text") or .describe('text')
      if (args) {
        // First try to match quoted strings with proper escape handling
        const quotedMatch = args.match(/^["'](.*)["']$/);
        if (quotedMatch) {
          // Get the content between quotes
          let description = quotedMatch[1];
          
          // Unescape common escape sequences
          description = description
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          
          result.description = description;
        }
      }
      return;
    }
    
    // Handle different argument types
    if (args) {
      // Check for object argument with custom error message
      if (args.includes('{') && args.includes('}')) {
        // Parse object argument
        try {
          // Simple object parsing for { message: "..." } pattern
          const messageMatch = args.match(/message\s*:\s*["']([^"']+)["']/);
          if (messageMatch) {
            result.customErrors![validatorName] = messageMatch[1];
            result.validators.push(`.${validatorName}({ message: "${messageMatch[1]}" })`);
          } else {
            result.validators.push(`.${validatorName}(${args})`);
          }
        } catch {
          result.validators.push(`.${validatorName}(${args})`);
        }
      } else if (args.includes('/') && validatorName === 'regex') {
        // Handle regex validator specially
        // Extract pattern and optional error message
        const regexMatch = args.match(/^(\/[^\/]+\/[gimuy]*)\s*(?:,\s*["']([^"']+)["'])?$/);
        if (regexMatch) {
          const [, pattern, errorMessage] = regexMatch;
          if (errorMessage) {
            result.validators.push(`.regex(${pattern}, "${errorMessage}")`);
          } else {
            result.validators.push(`.regex(${pattern})`);
          }
        } else {
          result.validators.push(`.${validatorName}(${args})`);
        }
      } else {
        // Simple arguments (numbers, strings, etc.)
        result.validators.push(`.${validatorName}(${args})`);
      }
    } else {
      // No arguments
      result.validators.push(`.${validatorName}()`);
    }
  });
  
  return result;
};

/**
 * Build the complete validation chain from parsed annotations
 */
export const buildValidationChain = (annotation: ZodAnnotation): string => {
  return annotation.validators.join('');
}