import { describe, expect, it } from "bun:test";
import { RuleTester } from "eslint";
import plugin, { isDirective } from "./no-comments.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});

const comment = [{ messageId: "comment" }];

tester.run("no-comments", plugin.rules["no-comments"], {
	valid: [
		"const a = 1;",
		"#!/usr/bin/env bun\nconst a = 1;",
		"// eslint-disable-next-line no-console -- a reason\nconsole.log(1);",
		"/* eslint-disable no-console */\nconsole.log(1);",
		"/* eslint-enable no-console */",
		"// eslint-disable-line",
		"/* global window */",
		"/* eslint no-console: \"off\" */",
		"// @ts-expect-error -- the reason\nlet a = 1;",
		"// @ts-nocheck",
		"/// <reference types=\"node\" />",
		"const a = /*#__PURE__*/ f();",
		"import(/* webpackIgnore: true */ \"x\");",
		"const url = \"https://example.com\";",
	],
	invalid: [
		{ code: "// a note\nconst a = 1;", errors: comment },
		{ code: "const a = 1; // trailing", errors: comment },
		{ code: "/* block */ const a = 1;", errors: comment },
		{ code: "/**\n * Doc.\n */\nfunction f() {}", errors: comment },
		{ code: "const el = <div>{/* jsx */}</div>;", errors: comment },
		{ code: "// eslint is great", errors: comment },
		{ code: "// TODO: fix", errors: comment },
		{ code: "// global state is shared", errors: comment },
		{ code: "// eslint no-console: off", errors: comment },
		{ code: "// one\n// two", errors: [...comment, ...comment] },
	],
});

describe("isDirective", () => {
	it("rejects prose that only starts like a directive", () => {
		expect(isDirective({ type: "Line", value: " eslint-disabled for now" })).toBe(false);
		expect(isDirective({ type: "Line", value: " global state is shared" })).toBe(false);
		expect(isDirective({ type: "Block", value: " globally unique " })).toBe(false);
		expect(isDirective({ type: "Line", value: " webpack is not used" })).toBe(false);
		expect(isDirective({ type: "Block", value: " eslint no-console: off " })).toBe(true);
	});
});
