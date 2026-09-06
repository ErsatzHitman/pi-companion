/**
 * Clipboard interface (plan.md §7.3).
 */
export interface Clipboard {
  readText(): Promise<string | null>;
  writeText(text: string): Promise<void>;
}
