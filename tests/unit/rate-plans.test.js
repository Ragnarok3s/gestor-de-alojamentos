const dayjs = require('dayjs');
const { createRatePlanService } = require('../../src/services/rate-plans');
const { ValidationError } = require('../../src/services/errors');
const { createDatabase } = require('../../src/infra/database');

describe('rate plans service - createPlan', () => {
  it('rejects negative price values with a ValidationError', () => {
    // Scenario: Attempt to create a plan with a negative minimum price, which violates pricing rules.
    const db = createDatabase(':memory:');
    const service = createRatePlanService({ db, dayjs });

    try {
      // Expectation: A ValidationError is raised because negative amounts are not allowed.
      expect(() =>
        service.createPlan({
          name: 'Plano negativo',
          minPrice: -10,
          maxPrice: 50
        })
      ).toThrow(ValidationError);
    } finally {
      db.close();
    }
  });

  it('throws ValidationError when the minimum price is higher than the maximum price', () => {
    // Scenario: Attempt to create a plan with minPrice greater than maxPrice, which should be rejected.
    const db = createDatabase(':memory:');
    const service = createRatePlanService({ db, dayjs });

    try {
      // Expectation: A ValidationError is raised to signal invalid price boundaries.
      expect(() =>
        service.createPlan({
          name: 'Plano inválido',
          minPrice: 200,
          maxPrice: 100
        })
      ).toThrow(ValidationError);
    } finally {
      db.close();
    }
  });

  it('persists a valid plan using the provided payload', () => {
    // Scenario: Store a well formed plan with description and price range in the in-memory database.
    const db = createDatabase(':memory:');
    const service = createRatePlanService({ db, dayjs });

    try {
      const insertProperty = db.prepare('INSERT INTO properties(name) VALUES (?)');
      const propertyInfo = insertProperty.run('Propriedade de teste');
      const propertyId = propertyInfo.lastInsertRowid;

      const plan = service.createPlan({
        name: 'Plano Flexível',
        description: 'Plano com tarifas variáveis',
        propertyId,
        minPrice: 50,
        maxPrice: 120,
        isDefault: true
      });

      // Expectation: The returned record mirrors the inserted values and remains active by default.
      expect(plan).toMatchObject({
        name: 'Plano Flexível',
        description: 'Plano com tarifas variáveis',
        property_id: propertyId,
        min_price: 50,
        max_price: 120,
        is_default: 1,
        active: 1
      });
      expect(plan.id).toBeDefined();
    } finally {
      db.close();
    }
  });
});
