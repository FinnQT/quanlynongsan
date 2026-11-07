const path = require('path');

/**
 * Khắc phục lỗi của app-builder.exe (--flatten):
 * Các thư viện cùng tiền tố tên (như `call-bind-apply-helpers` với `call-bind`,
 * `archiver-utils` với `archiver`, `es-abstract-get` với `es-abstract`) bị gộp nhầm
 * vào `conflictDependency` của gói ngắn hơn thay vì nằm ở `node_modules` gốc.
 */
exports.default = async function beforePack(context) {
  const info = context.packager.info;
  const lazy = info.getNodeDependencyInfo(context.packager.platform, true);
  const deps = await lazy.value;

  const promoted = [];
  for (const dep of deps) {
    if (!Array.isArray(dep.conflictDependency)) continue;
    const prefix = dep.dir + path.sep;
    dep.conflictDependency = dep.conflictDependency.filter((c) => {
      if (!c.dir.startsWith(prefix)) {
        promoted.push(c);
        return false;
      }
      return true;
    });
    if (!dep.conflictDependency.length) delete dep.conflictDependency;
  }
  deps.push(...promoted);
};
