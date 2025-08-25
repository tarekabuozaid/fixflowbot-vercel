// scripts/import-xlsx.ts
// Usage: npx ts-node scripts/import-xlsx.ts ./data/FixFlowDB.xlsx
import * as XLSX from 'xlsx';
import { PrismaClient, WorkOrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

// === Helpers: mapping & dates ===
const statusMap: Record<string, WorkOrderStatus> = {
  'open': 'open',
  'in progress': 'in_progress',
  'in_progress': 'in_progress',
  'done': 'done',
  'closed': 'closed'
};

const norm = (v: any) => (v ?? '').toString().trim();
const toDate = (v: any) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : d;
};

// Fallback creator لو صف في Sheet1 بلا Created By
async function ensureDefaultUser() {
  const tg = BigInt(9990000000);
  let u = await prisma.user.findUnique({ where: { tgId: tg } });
  if (!u) u = await prisma.user.create({ data: { tgId: tg, status: 'active' } });
  return u;
}

async function upsertFacilityByName(name: string, extra?: Partial<import('@prisma/client').Facility>) {
  return prisma.facility.upsert({
    where: { name },
    update: { ...(extra || {}) },
    create: { name, isDefault: false, isActive: true, planTier: 'Free', ...(extra || {}) }
  });
}

async function upsertUserByTgId(tgId: bigint, patch?: Partial<import('@prisma/client').User>) {
  return prisma.user.upsert({
    where: { tgId },
    update: { ...(patch || {}) },
    create: { tgId, status: 'active', ...(patch || {}) }
  });
}

// === Importers per sheet ===
async function importFacilities(ws: XLSX.WorkSheet) {
  console.log('📊 Importing Facilities...');
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
  let count = 0;
  
  for (const r of rows) {
    // أعمدة متوقعة: Name, City, Phone, Plan, IsActive, IsDefault
    const name = norm(r.Name || r.Facility || r.Title);
    if (!name) continue;
    
    await upsertFacilityByName(name, {
      planTier: norm(r.Plan || 'Free') || 'Free',
      isActive: String(r.IsActive ?? 'true').toLowerCase() === 'true',
      isDefault: String(r.IsDefault ?? 'false').toLowerCase() === 'true'
    });
    count++;
  }
  console.log(`✅ Imported ${count} facilities`);
}

async function importRegistrations(ws: XLSX.WorkSheet) {
  console.log('👥 Importing Registrations...');
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
  let count = 0;
  
  for (const r of rows) {
    // أعمدة متوقعة: tgId, Name, Username, Status, Role, Facility
    const tg = r.tgId ? BigInt(r.tgId) : null;
    if (!tg) continue;
    
    const user = await upsertUserByTgId(tg, {
      firstName: r.Name ?? undefined,
      username: r.Username ?? undefined,
      status: (norm(r.Status) || 'pending').toLowerCase() === 'active' ? 'active' : 'pending'
    });

    const facName = norm(r.Facility);
    if (facName) {
      const fac = await upsertFacilityByName(facName);
      // عضوية
      await prisma.facilityMember.upsert({
        where: { userId_facilityId: { userId: user.id, facilityId: fac.id } },
        update: { role: norm(r.Role || 'user').toLowerCase() },
        create: { userId: user.id, facilityId: fac.id, role: norm(r.Role || 'user').toLowerCase() }
      });
      // activeFacilityId إن كان Active ولا يملك منشأة نشطة
      if (user.status === 'active' && !user.activeFacilityId) {
        await prisma.user.update({ where: { id: user.id }, data: { activeFacilityId: fac.id } });
      }
    }
    count++;
  }
  console.log(`✅ Imported ${count} registrations`);
}

async function importWorkOrders(ws: XLSX.WorkSheet) {
  console.log('🔧 Importing Work Orders...');
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
  const fallback = await ensureDefaultUser();
  let count = 0;

  for (const r of rows) {
    // أعمدة شائعة: Status, Type, Priority, Location, Building, Room, Description, Comments,
    // Created By TgId, Assigned To TgId, Created Date, Assigned Date, Closed Date, Expected Completion,
    // Image URL, Materials, Cost, Notes, Facility/GROUP
    const status = statusMap[norm(r.Status).toLowerCase()] ?? 'open';
    const priority = norm(r.Priority) || null;

    const facName = norm(r.Facility || r.GROUP || 'Default Facility');
    const facility = await upsertFacilityByName(facName);

    const createdByTg = r['Created By TgId'] ? BigInt(r['Created By TgId']) : null;
    const createdBy = createdByTg
      ? await upsertUserByTgId(createdByTg, { activeFacilityId: facility.id })
      : fallback;

    const wo = await prisma.workOrder.create({
      data: {
        facilityId: facility.id,
        createdByUserId: createdBy.id,
        status,
        priority,
        location: r.Location ?? null,
        department: r.Department ?? null,
        description: r.Description ?? r.Comments ?? 'Imported from Excel',
        notes: r.Notes ?? null,
        createdAt: toDate(r['Created Date']) ?? undefined,
        updatedAt: toDate(r['Updated Date']) ?? undefined
      }
    });

    // سجلّ أولي في الـTimeline
    await prisma.statusHistory.create({
      data: {
        workOrderId: wo.id,
        oldStatus: 'open',
        newStatus: wo.status,
        updatedByUserId: wo.createdByUserId
      }
    });
    count++;
  }
  console.log(`✅ Imported ${count} work orders`);
}

async function importTimelines(ws: XLSX.WorkSheet) {
  console.log('📅 Importing Timelines...');
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null });
  let count = 0;
  
  for (const t of rows) {
    // متوقع: Request ID, Date, Old Status, New Status, Updated By TgId
    const idRaw = t['Request ID'] ?? t['WO ID'] ?? t['ID'];
    if (!idRaw) continue;
    const workOrderId = BigInt(idRaw);

    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) continue;

    const oldSt = statusMap[norm(t['Old Status']).toLowerCase()] ?? 'open';
    const newSt = statusMap[norm(t['New Status']).toLowerCase()] ?? 'open';

    let updaterId = wo.createdByUserId;
    if (t['Updated By TgId']) {
      const u = await upsertUserByTgId(BigInt(t['Updated By TgId']), { activeFacilityId: wo.facilityId });
      updaterId = u.id;
    }

    await prisma.statusHistory.create({
      data: {
        workOrderId,
        oldStatus: oldSt,
        newStatus: newSt,
        updatedByUserId: updaterId,
        createdAt: toDate(t['Date']) ?? undefined
      }
    });

    // لو newSt = closed نضمن closedAt
    if (newSt === 'closed' && !wo.closedAt) {
      await prisma.workOrder.update({ where: { id: workOrderId }, data: { status: 'closed' } });
    }
    count++;
  }
  console.log(`✅ Imported ${count} timeline entries`);
}

// === Entrypoint ===
(async function main() {
  try {
    const file = process.argv[2];
    if (!file) {
      console.error('Usage: ts-node scripts/import-xlsx.ts <path/to/file.xlsx>');
      process.exit(1);
    }
    
    console.log(`📁 Reading file: ${file}`);
    const wb = XLSX.readFile(file);
    console.log(`📋 Available sheets: ${Object.keys(wb.Sheets).join(', ')}`);

    // نفّذ حسب ما هو متاح من شيتات بالاسم:
    if (wb.Sheets['Facilities']) await importFacilities(wb.Sheets['Facilities']);
    if (wb.Sheets['Registrations']) await importRegistrations(wb.Sheets['Registrations']);
    if (wb.Sheets['Sheet1'] || wb.Sheets['Requests']) {
      const sheet = wb.Sheets['Sheet1'] ?? wb.Sheets['Requests'];
      await importWorkOrders(sheet);
    }
    if (wb.Sheets['Timelines']) await importTimelines(wb.Sheets['Timelines']);

    console.log('🎉 Import finished successfully!');
  } catch (e) {
    console.error('❌ Import failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
