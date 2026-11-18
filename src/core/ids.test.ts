import { normaliseTagName, occurrenceId, tagId, uuidV5 } from './ids';

describe('name-based ids', () => {
  it('matches the RFC 4122 version 5 reference value', () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, 'www.example.com')
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('handles text outside ASCII', () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, 'कार्य ✓')
    expect(uuidV5('कार्य ✓', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('b5dbdb83-451d-5854-a2d6-16cb8d157d27');
  });

  it('gives the same tag the same id on every device, whatever the case', () => {
    const user = '11111111-1111-4111-8111-111111111111';
    expect(tagId(user, 'Exam')).toBe(tagId(user, ' #exam '));
    expect(tagId(user, 'exam')).not.toBe(tagId('22222222-2222-4222-8222-222222222222', 'exam'));
    expect(normaliseTagName('  Deep Work ')).toBe('deep-work');
  });

  it('gives each occurrence of a task its own stable id', () => {
    const task = '33333333-3333-4333-8333-333333333333';
    expect(occurrenceId(task, '2026-11-14')).toBe(occurrenceId(task, '2026-11-14'));
    expect(occurrenceId(task, '2026-11-14')).not.toBe(occurrenceId(task, '2026-11-15'));
    expect(occurrenceId(task, '2026-11-14')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
