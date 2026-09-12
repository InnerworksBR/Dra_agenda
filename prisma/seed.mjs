// Seed em JS puro — usado pelo entrypoint do container. O seed.ts original
// continua existindo para `npm run seed` em dev (que tem tsx).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const services = [
  {
    id: 'consulta-inicial',
    name: 'Consulta inicial',
    durationMinutes: 15,
    active: true,
    schedulingRules: {},
  },
  {
    id: 'retorno',
    name: 'Retorno',
    durationMinutes: 15,
    active: true,
    schedulingRules: {},
  },
];

async function main() {
  for (const service of services) {
    await prisma.service.upsert({
      where: { id: service.id },
      create: service,
      update: {
        name: service.name,
        durationMinutes: service.durationMinutes,
        active: service.active,
        schedulingRules: service.schedulingRules,
      },
    });
  }
  console.log(`Seed concluído: ${services.length} serviços sincronizados.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
