"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAddress, looksLikeAddress, splitAddressList } from "@/lib/format";
import { matchContacts, type Contact } from "@/lib/mail/contact-match";

type Address = { name?: string; address: string };

/** An odd number of unescaped quotes: the comma being typed belongs to a quoted name. */
function insideQuote(text: string): boolean {
	return (text.replace(/\\./g, "").match(/"/g)?.length ?? 0) % 2 === 1;
}

/**
 * To, Cc or Bcc as chips. The field's value stays the plain comma list compose
 * already sends; the text being typed joins it on comma, Enter, Tab, paste or
 * blur. Suggestions come from the people in recent mail.
 */
export function RecipientField({
	id,
	label,
	value,
	onChange,
	contacts,
	placeholder,
	autoFocus,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	contacts: Contact[];
	placeholder?: string;
	autoFocus?: boolean;
}) {
	const [text, setText] = React.useState("");
	const [open, setOpen] = React.useState(false);
	const [active, setActive] = React.useState(0);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const listId = `${id}-suggestions`;

	const chips = React.useMemo(() => splitAddressList(value), [value]);
	const taken = React.useMemo(() => new Set(chips.map((c) => c.address.toLowerCase())), [chips]);
	const suggestions = open ? matchContacts(contacts, text, taken) : [];
	const current = suggestions[Math.min(active, suggestions.length - 1)];

	const write = (list: Address[]) => onChange(list.map(formatAddress).join(", "));

	function commit(raw: string) {
		const seen = new Set(taken);
		const added = splitAddressList(raw).filter((a) => {
			const key = a.address.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		if (added.length) write([...chips, ...added]);
		setText("");
		setActive(0);
	}

	function pick(contact: Contact) {
		write([...chips, { name: contact.name, address: contact.address }]);
		setText("");
		setActive(0);
		inputRef.current?.focus();
	}

	function remove(index: number) {
		write(chips.filter((_, i) => i !== index));
		inputRef.current?.focus();
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		const mod = e.metaKey || e.ctrlKey;
		if (current && !mod) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : -1;
				setActive((a) => (Math.min(a, suggestions.length - 1) + step + suggestions.length) % suggestions.length);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				pick(current);
				return;
			}
			if (e.key === "Escape") {
				// Close the list only; compose and the reader behind it stay put.
				e.preventDefault();
				e.stopPropagation();
				setOpen(false);
				return;
			}
		}
		if ((e.key === "," || e.key === ";") && !insideQuote(text)) {
			e.preventDefault();
			commit(text);
			return;
		}
		if (e.key === "Enter" && text.trim()) {
			// With ⌘/Ctrl, compose sends next; the address must be in the list first.
			if (!mod) e.preventDefault();
			commit(text);
			return;
		}
		if (e.key === "Backspace" && !text && chips.length && e.currentTarget.selectionStart === 0) {
			// Takes the last address back into the box to edit, as Gmail does.
			e.preventDefault();
			const last = chips[chips.length - 1]!;
			write(chips.slice(0, -1));
			setText(formatAddress(last));
		}
	}

	return (
		<div className="relative flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5">
			{chips.map((chip, i) => {
				const bad = !looksLikeAddress(chip.address);
				const shown = chip.name || chip.address;
				return (
					<span
						key={`${chip.address}-${i}`}
						title={bad ? "Not an email address" : chip.address}
						className={cn(
							"inline-flex h-7 max-w-full items-center gap-0.5 rounded-pill bg-card pr-0.5 pl-2.5 text-[13px] ring-1 ring-border dark:bg-card-nested dark:ring-glass-border",
							bad && "text-destructive ring-destructive/50 dark:ring-destructive/50",
						)}
					>
						<span className="max-w-52 truncate">{shown}</span>
						<button
							type="button"
							onClick={() => remove(i)}
							aria-label={`Remove ${shown}`}
							className="grid size-6 shrink-0 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-foreground/5 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
						>
							<X className="size-3" />
						</button>
					</span>
				);
			})}
			<input
				ref={inputRef}
				id={id}
				role="combobox"
				aria-expanded={Boolean(current)}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={current ? `${listId}-${suggestions.indexOf(current)}` : undefined}
				value={text}
				onChange={(e) => {
					setText(e.target.value);
					setOpen(true);
					setActive(0);
				}}
				onKeyDown={onKeyDown}
				onPaste={(e) => {
					const pasted = e.clipboardData.getData("text");
					if (!/[,;\n]/.test(pasted)) return;
					e.preventDefault();
					commit(text + pasted.replace(/\r?\n/g, ","));
				}}
				onBlur={() => {
					commit(text);
					setOpen(false);
				}}
				placeholder={chips.length ? undefined : placeholder}
				autoFocus={autoFocus}
				autoComplete="off"
				spellCheck={false}
				className="h-7 min-w-28 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
			/>
			{current && (
				<ul
					id={listId}
					role="listbox"
					aria-label={`${label} suggestions`}
					className="absolute top-full left-0 z-20 -mt-0.5 w-full max-w-sm overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-lift ring-1 ring-border dark:ring-glass-border"
				>
					{suggestions.map((c, i) => (
						<li
							key={c.address}
							id={`${listId}-${i}`}
							role="option"
							aria-selected={c === current}
							// Keep focus in the input so blur doesn't commit the half-typed text first.
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => pick(c)}
							onMouseEnter={() => setActive(i)}
							className={cn("flex cursor-default flex-col rounded-lg px-3 py-1.5", c === current && "bg-muted")}
						>
							<span className="truncate text-[13px] text-foreground">{c.name ?? c.address}</span>
							{c.name && <span className="truncate text-[11.5px] text-ink-2">{c.address}</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
