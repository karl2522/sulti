export interface Finding {
  path: string;
  line: number;
  rule: string;
}
export const RULES: { name: string; re: RegExp }[];
export const FORBIDDEN_FILES: RegExp[];
export function shannon(s: string): number;
export function isHighEntropy(token: string): boolean;
export function scanText(path: string, content: string): Finding[];
