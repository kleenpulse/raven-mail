/**
 * A script that runs during HTML parsing (hard loads). On the client it
 * renders inert as text/plain, which silences React's <script> warning;
 * suppressHydrationWarning covers the type mismatch.
 */
export function InlineScript({ html }: { html: string }) {
	return (
		<script
			type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
			suppressHydrationWarning
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
