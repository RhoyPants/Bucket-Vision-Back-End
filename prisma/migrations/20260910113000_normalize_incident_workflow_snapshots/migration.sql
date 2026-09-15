-- Translate stored JSON contracts so existing incidents keep their original resolver rules.
UPDATE "IncidentWorkflow" workflow
SET "levels" = (
  SELECT jsonb_agg((item - 'resolverRule') || jsonb_build_object('completionRule', COALESCE(item->'completionRule', item->'resolverRule', '"ANY_ONE"'::jsonb)) ORDER BY ordinal)
  FROM jsonb_array_elements(workflow."levels") WITH ORDINALITY AS level(item, ordinal)
);

UPDATE "IncidentReport" incident
SET "workflowSnapshot" = (
      (incident."workflowSnapshot" - 'matrixId' - 'matrixVersion' - 'matrixName')
      || jsonb_build_object(
        'workflowId', incident."workflowSnapshot"->'matrixId',
        'workflowVersion', incident."workflowSnapshot"->'matrixVersion',
        'workflowName', incident."workflowSnapshot"->'matrixName',
        'levels', (
          SELECT jsonb_agg((item - 'resolverRule') || jsonb_build_object('completionRule', COALESCE(item->'completionRule', item->'resolverRule', '"ANY_ONE"'::jsonb)) ORDER BY ordinal)
          FROM jsonb_array_elements(incident."workflowSnapshot"->'levels') WITH ORDINALITY AS level(item, ordinal)
        )
      )
    ),
    "workflow" = (
      (incident."workflow" - 'matrixId' - 'matrixVersion' - 'resolverRule' - 'slaDeadline')
      || jsonb_build_object(
        'workflowId', incident."workflow"->'matrixId',
        'workflowVersion', incident."workflow"->'matrixVersion',
        'completionRule', COALESCE(incident."workflow"->'completionRule', incident."workflow"->'resolverRule', '"ANY_ONE"'::jsonb),
        'levelSlaDeadline', incident."workflow"->'slaDeadline',
        'isLevelOverdue', false,
        'levelSlaBreachedAt', NULL
      )
    )
WHERE incident."workflowSnapshot" IS NOT NULL AND incident."workflow" IS NOT NULL;
