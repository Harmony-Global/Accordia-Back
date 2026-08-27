insert into public.job_conversations (
  job_id,
  application_id,
  client_id,
  professional_id,
  opened_by,
  status,
  created_at
)
select
  a.job_id,
  a.id,
  j.client_id,
  a.professional_id,
  j.client_id,
  'open',
  coalesce(ja.created_at, a.updated_at, now())
from public.applications a
join public.jobs j on j.id = a.job_id
left join public.job_awards ja on ja.application_id = a.id
where a.status = 'awarded'
  and j.status in ('awarded', 'in_progress', 'in_review', 'delivered', 'closed')
  and (
    ja.id is not null
    or j.awarded_to = a.professional_id
    or exists (
      select 1
      from public.job_awards existing_award
      where existing_award.job_id = a.job_id
        and existing_award.professional_id = a.professional_id
    )
  )
on conflict (job_id, professional_id) do update
set application_id = excluded.application_id,
    status = 'open';

update public.messages m
set conversation_id = jc.id
from public.job_conversations jc
where m.conversation_id is null
  and m.job_id = jc.job_id
  and (
    (m.sender_id = jc.client_id and m.receiver_id = jc.professional_id)
    or (m.sender_id = jc.professional_id and m.receiver_id = jc.client_id)
  );
