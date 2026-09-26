import { canDeleteMedia } from "./media-permissions.ts";

const driver = {
  userId: "driver-a", worker: false,
  profile: { company_id: "company-a", role: "driver", status: "active" },
};
const asset = { company_id: "company-a", uploaded_by: "driver-a" };

Deno.test("media deletion requires ownership or an active tenant manager", () => {
  const cases: Array<[string, Parameters<typeof canDeleteMedia>[0], Parameters<typeof canDeleteMedia>[1], boolean]> = [
    ["uploader", driver, asset, true],
    ["another uploader", driver, { ...asset, uploaded_by: "other" }, false],
    ["worker-imported asset", driver, { ...asset, uploaded_by: null }, false],
    ["missing uploader", driver, { company_id: "company-a" }, false],
    ["different tenant", driver, { ...asset, company_id: "company-b" }, false],
    ["worker", { ...driver, worker: true }, asset, false],
    ["anonymous", { ...driver, userId: null }, asset, false],
    ["suspended owner", { ...driver, profile: { ...driver.profile, status: "suspended" } }, asset, false],
    ["tenant dispatcher", { ...driver, profile: { ...driver.profile, role: "dispatcher" } }, { ...asset, uploaded_by: null }, true],
    ["tenant admin", { ...driver, profile: { ...driver.profile, role: "company_admin" } }, { ...asset, uploaded_by: "other" }, true],
    ["cross-tenant admin", { ...driver, profile: { ...driver.profile, role: "company_admin" } }, { ...asset, company_id: "company-b" }, false],
  ];
  for (const [label, actor, media, expected] of cases) {
    if (canDeleteMedia(actor, media) !== expected) throw new Error(label);
  }
});
