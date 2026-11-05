// The database is managed with the Supabase CLI (supabase/README.md), which
// only runs migrations named <14-digit timestamp>_<name>.sql. An old-style
// file ("088-something.sql") would be silently skipped and never reach the
// hosted project, so it fails here instead.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "..", "supabase", "migrations");

test("every migration is a Supabase CLI migration, starting from the baseline", () => {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql"));
  const strays = files.filter((file) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(file));
  // Make changes with `npm run db:new -- <name>`, not by naming files by hand.
  expect(strays).toEqual([]);
  expect(files.sort()[0]).toBe("20261105000000_torres_database.sql");
});
