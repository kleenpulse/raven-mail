"use client";

import * as React from "react";

export type Account = {
	email: string;
	displayName: string;
	provider: string;
};

const AccountContext = React.createContext<Account | null>(null);

export function AccountProvider({
	account,
	children,
}: {
	account: Account;
	children: React.ReactNode;
}) {
	return <AccountContext value={account}>{children}</AccountContext>;
}

export function useAccount(): Account {
	const account = React.use(AccountContext);
	if (!account) throw new Error("useAccount must be used inside <AccountProvider>");
	return account;
}
