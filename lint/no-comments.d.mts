import type { ESLint, Rule } from "eslint";

export declare const isDirective: (comment: { type: string; value: string }) => boolean;

declare const plugin: ESLint.Plugin & { rules: { "no-comments": Rule.RuleModule } };

export default plugin;
