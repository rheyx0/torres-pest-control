// Services route — the service catalog and each service's default materials
// (migration 047). A service is WHAT is sold and what it uses; since migration
// 050 it is also what a service report records as the treatment performed.

import PageHeader from "../components/common/PageHeader";
import ServiceProfilesAdmin from "../components/services/ServiceProfilesAdmin";
import { pageShell } from "../styles/theme";

function ServicesPage() {
  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Operations" title="Services" />
      <ServiceProfilesAdmin />
    </div>
  );
}

export default ServicesPage;
