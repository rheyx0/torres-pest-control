// Settings route — hosts the change-password form.
//
// Lives in pages/ rather than components/settings/ so the rule "pages/ are
// routes, components/ are pieces" holds everywhere.

import PageHeader from "../components/common/PageHeader";
import ChangePassword from "../components/settings/ChangePassword";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import { pageShell } from "../styles/theme";

function SettingsPage() {
  const { changeOwnPassword } = useUsers();
  const { showSuccess } = useToast();

  const handleChangePassword = async (currentPassword, newPassword) => {
    const result = await changeOwnPassword(currentPassword, newPassword);
    if (result === true) {
      showSuccess("Your password has been updated.");
      return true;
    }
    return result;
  };

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Account" title="Settings" />
      <ChangePassword onSubmit={handleChangePassword} />
    </div>
  );
}

export default SettingsPage;
