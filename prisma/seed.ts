import { PrismaClient, OrgRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const passwordHash = await bcrypt.hash('Admin1234!', 12);

  const user = await prisma.user.upsert({
    where: { email: 'admin@webwow.dev' },
    update: {},
    create: {
      email: 'admin@webwow.dev',
      passwordHash,
      name: 'Admin User',
      emailVerified: true,
    },
  });

  // Create demo organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      usageCap: 500,
    },
  });

  // Add user as OWNER
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: user.id,
      role: OrgRole.OWNER,
      joinedAt: new Date(),
    },
  });

  console.log(`✅ Created user: ${user.email}`);
  console.log(`✅ Created org: ${org.name} (${org.slug})`);
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
