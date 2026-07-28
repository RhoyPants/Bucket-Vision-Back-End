INSERT INTO "Module" ("id", "name", "path", "isActive")
VALUES ('793b9cd9-55ab-42ad-b9ec-eb882d6f69dc', 'dashboard', '/dashboard', true)
ON CONFLICT ("name") DO UPDATE SET "path" = EXCLUDED."path", "isActive" = true;

INSERT INTO "RolePermission" ("id", "roleId", "moduleId", "permissionId")
SELECT
  substr(md5(role."id" || permission."id" || 'dashboard'), 1, 8) || '-' ||
  substr(md5(role."id" || permission."id" || 'dashboard'), 9, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'dashboard'), 13, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'dashboard'), 17, 4) || '-' ||
  substr(md5(role."id" || permission."id" || 'dashboard'), 21, 12),
  role."id",
  module."id",
  permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
JOIN "Module" AS module ON module."name" = 'dashboard'
ON CONFLICT ("roleId", "moduleId", "permissionId") DO NOTHING;
