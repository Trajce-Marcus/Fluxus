import { describe, it, expect } from 'vitest';
import { parseExpression } from '../src/parser';
import type { Binary, Call, InExpr, Member } from '../src/ast';

describe('parser — literals and primaries', () => {
  it('parses literals', () => {
    expect(parseExpression('42')).toMatchObject({ kind: 'number', value: 42 });
    expect(parseExpression('12.5')).toMatchObject({ kind: 'number', value: 12.5 });
    expect(parseExpression("'Open'")).toMatchObject({ kind: 'string', value: 'Open' });
    expect(parseExpression('true')).toMatchObject({ kind: 'boolean', value: true });
    expect(parseExpression('null')).toMatchObject({ kind: 'null' });
  });

  it('parses list and object literals', () => {
    expect(parseExpression("['Sydney', 'Melbourne']")).toMatchObject({
      kind: 'list',
      items: [{ value: 'Sydney' }, { value: 'Melbourne' }],
    });
    expect(parseExpression("{ work_order_id: 1, qty: 2 }")).toMatchObject({
      kind: 'object',
      entries: [
        { key: 'work_order_id', value: { value: 1 } },
        { key: 'qty', value: { value: 2 } },
      ],
    });
  });

  it('stores identifier names lowercased (case-insensitivity)', () => {
    expect(parseExpression('Status')).toMatchObject({ kind: 'ident', name: 'status' });
  });
});

describe('parser — precedence (§3.2)', () => {
  it('and binds tighter than or', () => {
    const ast = parseExpression('a or b and c') as Binary;
    expect(ast.op).toBe('or');
    expect((ast.right as Binary).op).toBe('and');
  });

  it('comparison binds tighter than and', () => {
    const ast = parseExpression("a = 1 and b = 2") as Binary;
    expect(ast.op).toBe('and');
    expect((ast.left as Binary).op).toBe('=');
    expect((ast.right as Binary).op).toBe('=');
  });

  it('arithmetic binds tighter than comparison', () => {
    const ast = parseExpression('a + 1 > b * 2') as Binary;
    expect(ast.op).toBe('>');
    expect((ast.left as Binary).op).toBe('+');
    expect((ast.right as Binary).op).toBe('*');
  });

  it("between's and belongs to between, not logic", () => {
    const ast = parseExpression('x between 1 and 5 or y') as Binary;
    expect(ast.op).toBe('or');
    expect(ast.left).toMatchObject({ kind: 'between', lower: { value: 1 }, upper: { value: 5 } });
  });

  it('not is prefix over comparisons', () => {
    const ast = parseExpression("not status = 'Closed'");
    expect(ast).toMatchObject({ kind: 'unary', op: 'not', operand: { kind: 'binary', op: '=' } });
  });
});

describe('parser — comparison forms', () => {
  it('normalizes == and <>', () => {
    expect((parseExpression('a == b') as Binary).op).toBe('=');
    expect((parseExpression('a <> b') as Binary).op).toBe('!=');
  });

  it('is null / is not null', () => {
    expect(parseExpression('contract_id is null')).toMatchObject({ kind: 'isnull', negated: false });
    expect(parseExpression('contract_id is not null')).toMatchObject({ kind: 'isnull', negated: true });
  });

  it('like and not like', () => {
    expect(parseExpression("name like 'pump%'")).toMatchObject({
      kind: 'like',
      negated: false,
      pattern: { value: 'pump%' },
    });
    expect(parseExpression("name not like 'pump%'")).toMatchObject({ kind: 'like', negated: true });
  });

  it('in with a bracket list, a paren list, and a single paren expression', () => {
    expect(parseExpression("x in ['a', 'b']")).toMatchObject({
      kind: 'in',
      source: { kind: 'list' },
    });
    const parenList = parseExpression("work_group in ('WG1', 'WG2')") as InExpr;
    expect(parenList.source).toMatchObject({ kind: 'list', items: [{ value: 'WG1' }, { value: 'WG2' }] });
    // single paren stays an expression — list-or-scalar resolved at runtime (subquery habit)
    const single = parseExpression('id in (already)') as InExpr;
    expect(single.source).toMatchObject({ kind: 'ident', name: 'already' });
  });

  it('not in', () => {
    expect(parseExpression('id not in (already)')).toMatchObject({ kind: 'in', negated: true });
  });
});

describe('parser — postfix: members, calls, chains', () => {
  it('parses dotted paths', () => {
    const ast = parseExpression('ctx.record.contract_id.contact_email') as Member;
    expect(ast).toMatchObject({
      kind: 'member',
      name: 'contact_email',
      object: { kind: 'member', name: 'contract_id', object: { kind: 'member', name: 'record' } },
    });
  });

  it('allows keywords as member names after a dot (D7)', () => {
    expect(parseExpression('ctx.record.like')).toMatchObject({ kind: 'member', name: 'like' });
  });

  it('parses calls with aliases and directions', () => {
    const select = parseExpression('records.jobs.select(id, title: code, start: due_date)') as Call;
    expect(select.args).toMatchObject([
      { value: { kind: 'ident', name: 'id' } },
      { alias: 'title', value: { kind: 'ident', name: 'code' } },
      { alias: 'start', value: { kind: 'ident', name: 'due_date' } },
    ]);

    const orderBy = parseExpression('records.jobs.orderBy(name desc, code)') as Call;
    expect(orderBy.args).toMatchObject([
      { value: { name: 'name' }, direction: 'desc' },
      { value: { name: 'code' } },
    ]);
  });

  it('parses indexing', () => {
    expect(parseExpression('items[0]')).toMatchObject({ kind: 'index', index: { value: 0 } });
  });
});

describe('parser — grammar doc examples verbatim (§3.4, §4.3)', () => {
  const examples = [
    "ctx.record.status != 'Closed'",
    'attrs.qty > 0 and attrs.qty <= 100',
    "ctx.record.due_date between date('2026-07-01') and date('2026-07-31')",
    'ctx.record.due_date <= now().addDays(7)',
    "ctx.record.work_group in ('WG1', 'WG2')",
    'ctx.record.contract_id is not null',
    "name like 'pump%'",
    "iif(attrs.urgent, 'P1', 'P3')",
    "'Job ' + ctx.record.code + ' assigned'",
    "attrs.qty + ' attributes'",
    `records.resources
  .where(rest_type = 'Labour' and status = 'Active')
  .orderBy(name)
  .select(id, name, rate)`,
    `records.jobs
  .where(work_group in ctx.page.selectedGroups
         and due_date between ctx.page.rangeStart and ctx.page.rangeEnd)
  .select(id, title: code, start: due_date, laneId: work_group)`,
    'records.assets.where(asset_no = attrs.asset).first',
    "records.work_orders.where(status = 'Open').count",
    "records.work_orders.where(work_group.region = 'North')",
    'records.work_orders.select(id, group: work_group.name)',
    `records.assets.where(id in
  records.wo_assets.where(work_order_id = ctx.record.id).values(asset_id))`,
    "records.resources.where(status = 'Active').where(true)",
  ];

  for (const source of examples) {
    it(`parses: ${source.replace(/\s+/g, ' ').slice(0, 60)}`, () => {
      expect(() => parseExpression(source)).not.toThrow();
    });
  }

  it('multi-line chains parse identically to single-line (ignoring positions)', () => {
    const stripPos = (node: unknown): unknown =>
      JSON.parse(JSON.stringify(node, (key, value) => (key === 'pos' ? undefined : value)));
    const multi = parseExpression("records.resources\n  .where(rest_type = 'Labour')\n  .orderBy(name)");
    const single = parseExpression("records.resources.where(rest_type = 'Labour').orderBy(name)");
    expect(stripPos(multi)).toEqual(stripPos(single));
  });
});

describe('parser — errors', () => {
  it('rejects trailing content after the expression', () => {
    expect(() => parseExpression('a = 1 b')).toThrowError(/Unexpected 'b'/);
  });

  it('rejects a bare reserved word as an expression', () => {
    expect(() => parseExpression('between')).toThrowError(/reserved word/);
  });

  it('rejects a reserved word as an unquoted object key', () => {
    expect(() => parseExpression('{ like: 1 }')).toThrowError(/reserved word/);
  });

  it('reports missing closing brackets', () => {
    expect(() => parseExpression('iif(a, b')).toThrowError(/Expected '\)'/);
    expect(() => parseExpression("['a', 'b'")).toThrowError(/Expected ']'/);
  });

  it('rejects empty input', () => {
    expect(() => parseExpression('   ')).toThrowError(/Expected an expression/);
  });
});
