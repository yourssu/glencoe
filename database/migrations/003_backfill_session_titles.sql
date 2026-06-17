-- 기존 sessions 행의 title 백필
-- 각 세션의 가장 오래된 agent_calls.question을 찾아
-- 첫 줄만 잘라내고(개행 기준) 80자 초과 시 "..." 말줄임 처리하여 title에 반영
-- 빈 question이 첫 메시지인 세션은 title을 NULL로 유지

WITH first_questions AS (
  SELECT DISTINCT ON (session_id)
    session_id,
    question
  FROM agent_calls
  WHERE session_id IS NOT NULL
    AND question IS NOT NULL
  ORDER BY session_id, created_at ASC
),
trimmed AS (
  SELECT
    session_id,
    TRIM(split_part(question, E'\n', 1)) AS first_line
  FROM first_questions
),
titles AS (
  SELECT
    session_id,
    CASE
      WHEN char_length(first_line) > 80 THEN LEFT(first_line, 80) || '...'
      ELSE first_line
    END AS title
  FROM trimmed
)
UPDATE sessions s
SET title = t.title
FROM titles t
WHERE s.id = t.session_id
  AND s.title IS NULL
  AND t.title <> '';
