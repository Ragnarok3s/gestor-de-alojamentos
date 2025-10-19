const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const { createRatePlanService } = require('../../src/services/rate-plans');
const { ValidationError } = require('../../src/services/errors');

function createInMemoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE rate_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      min_price REAL,
      max_price REAL,
      rules TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe('rate plans service - createPlan', () => {
  it('rejects negative price values with a ValidationError', () => {
    // Scenario: Attempt to create a plan with a negative minimum price, which violates pricing rules.
    const db = createInMemoryDb();
    const service = createRatePlanService({ db, dayjs });

    // Expectation: A ValidationError is raised because negative amounts are not allowed.
    expect(() =>
      service.createPlan({
        name: 'Plano negativo',
        minPrice: -10,
        maxPrice: 50
      })
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when the minimum price is higher than the maximum price', () => {
    // Scenario: Attempt to create a plan with minPrice greater than maxPrice, which should be rejected.
    const db = createInMemoryDb();
    const service = createRatePlanService({ db, dayjs });

    // Expectation: A ValidationError is raised to signal invalid price boundaries.
    expect(() =>
      service.createPlan({
        name: 'Plano inválido',
        minPrice: 200,
        maxPrice: 100
      })
    ).toThrow(ValidationError);
  });

  it('persists a valid plan using the provided payload', () => {
    // Scenario: Store a well formed plan with description and price range in the in-memory database.
    const db = createInMemoryDb();
    const service = createRatePlanService({ db, dayjs });

    const plan = service.createPlan({
      name: 'Plano Flexível',
      description: 'Plano com tarifas variáveis',
      propertyId: 7,
      minPrice: 50,
      maxPrice: 120,
      isDefault: true
    });

    // Expectation: The returned record mirrors the inserted values and remains active by default.
    expect(plan).toMatchObject({
      name: 'Plano Flexível',
      description: 'Plano com tarifas variáveis',
      property_id: 7,
      min_price: 50,
      max_price: 120,
      is_default: 1,
      active: 1
    });
    expect(plan.id).toBeDefined();
  });
});
