// The row menu's status action.
//
// A PENDING account — created but never signed into — can sign in: the first
// successful login promotes it to ACTIVE. The menu used to label such a row
// "Activate", so an admin had no control that would stop it being used, and
// clicking the one control there was flipped it to ACTIVE outright. Only an
// INACTIVE account should be offered "Activate".

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserList from "../UserList";

const baseUser = {
  id: "u1",
  name: "Karl Hameed",
  username: "karl",
  email: "karl@example.com",
  phone: "09171234567",
  role: "TECHNICIAN",
};

function renderList(status, onToggleStatus = jest.fn()) {
  render(
    <UserList
      users={[{ ...baseUser, status }]}
      canEdit
      onEdit={jest.fn()}
      onAvatarChange={jest.fn()}
      onToggleStatus={onToggleStatus}
      onResetPassword={jest.fn()}
    />
  );
  return onToggleStatus;
}

async function openRowMenu() {
  await userEvent.click(screen.getByRole("button", { name: "User actions" }));
}

describe("UserList status action", () => {
  it("offers to deactivate an active account", async () => {
    renderList("ACTIVE");
    await openRowMenu();
    expect(screen.getByRole("menuitem", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("offers to deactivate a pending account, which can still sign in", async () => {
    renderList("PENDING");
    await openRowMenu();
    expect(screen.getByRole("menuitem", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("offers to activate only a deactivated account", async () => {
    renderList("INACTIVE");
    await openRowMenu();
    expect(screen.getByRole("menuitem", { name: "Activate" })).toBeInTheDocument();
  });

  it("reports the row it was asked to toggle", async () => {
    const onToggleStatus = renderList("PENDING");
    await openRowMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    expect(onToggleStatus).toHaveBeenCalledWith("u1");
  });
});
