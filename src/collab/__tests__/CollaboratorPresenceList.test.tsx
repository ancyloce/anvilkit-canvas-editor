import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { CollaboratorPresenceList } from "../CollaboratorPresenceList.js";

afterEach(cleanup);

describe("CollaboratorPresenceList", () => {
	it("announces identity, cursor, selection, and connection state without color dependence", async () => {
		const view = render(
			<CollaboratorPresenceList
				connectionState={{
					kind: "reconnecting",
					attempt: 2,
					backoffMs: 500,
					pendingLocalTransactions: 1,
				}}
				peers={[
					{
						peer: { id: "user-1", displayName: "Avery", color: "#7c3aed" },
						cursor: { x: 12.4, y: 98.6 },
						selection: { nodeIds: ["node-1", "node-2"] },
					},
				]}
			/>,
		);
		expect(view.getByRole("status")).toHaveTextContent(
			"Reconnecting, attempt 2. 1 local change is waiting to synchronize.",
		);
		expect(
			view.getByRole("list", { name: "Connected collaborators" }),
		).toHaveTextContent("AveryCursor at 12, 99. 2 objects selected.");
		expect((await axe(view.container)).violations).toHaveLength(0);
	});

	it("shows an explicit empty state while offline", () => {
		const view = render(
			<CollaboratorPresenceList
				connectionState={{
					kind: "offline",
					since: "2026-08-28T12:00:00.000Z",
					pendingLocalTransactions: 0,
				}}
				peers={[]}
			/>,
		);
		expect(view.getByText("No collaborators connected.")).toBeVisible();
		expect(view.getByRole("status")).toHaveTextContent("Offline since");
	});
});
