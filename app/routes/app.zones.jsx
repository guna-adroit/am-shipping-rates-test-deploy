import { Outlet } from "react-router";

// This is the layout for all /app/zones/* routes.
// It renders nothing itself — child routes render via <Outlet />.
// app.zones._index.jsx  → /app/zones       (zones list)
// app.zones.new.jsx     → /app/zones/new   (create zone)
// app.zones.$zoneId.jsx → /app/zones/:id   (zone sub-layout)
export default function ZonesLayout() {
  return <Outlet />;
}
