import { Outlet } from "react-router";

// Layout for all /app/zones/:zoneId/* routes.
// app.zones.$zoneId._index.jsx          → /app/zones/:zoneId       (edit zone)
// app.zones.$zoneId.rates.new.jsx       → /app/zones/:zoneId/rates/new
// app.zones.$zoneId.rates.$rateId.jsx   → /app/zones/:zoneId/rates/:rateId
export default function ZoneLayout() {
  return <Outlet />;
}
