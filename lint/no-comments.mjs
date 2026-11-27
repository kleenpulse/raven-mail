const ANY_DIRECTIVE =
	/^\s*(?:eslint-disable(?:-next-line|-line)?(?:\s|$)|eslint-enable(?:\s|$)|@ts-(?:expect-error|ignore|nocheck|check)\b|[#@]__PURE__|webpack[A-Z]|turbopack[A-Z]|\/\s*<reference\s)/;

const BLOCK_DIRECTIVE = /^\s*(?:eslint\s+[\w@/-]+\s*:|globals?\s+\w|exported\s+\w)/;

export const isDirective = (comment) =>
	ANY_DIRECTIVE.test(comment.value) ||
	(comment.type === "Block" && BLOCK_DIRECTIVE.test(comment.value));

const noComments = {
	meta: {
		type: "suggestion",
		docs: {
			description: "Ban code comments. Decisions go in docs/adr, hacks go in issues.",
		},
		messages: {
			comment:
				"Comments are banned. Put the why in an ADR (docs/adr/), or make the code say it.",
		},
		schema: [],
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (comment.type === "Shebang" || isDirective(comment)) continue;
					context.report({ loc: comment.loc, messageId: "comment" });
				}
			},
		};
	},
};

const plugin = {
	meta: { name: "local" },
	rules: { "no-comments": noComments },
};

export default plugin;
