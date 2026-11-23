-- TaskFlow migration 6: a picture for each task
--
-- One optional column, as text: "e:<emoji>", "c:<clipart key>" or
-- "i:<storage path>" (src/core/appearance.ts). Photos live in the private
-- attachments bucket under the owner's own folder, which the existing
-- Storage rules already limit to that owner. The sync functions find
-- writable columns by themselves, so nothing else changes.

alter table public.tasks
  add column if not exists icon text
    constraint tasks_icon_length check (icon is null or char_length(icon) <= 300);
