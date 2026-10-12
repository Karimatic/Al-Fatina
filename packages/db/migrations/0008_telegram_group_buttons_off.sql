-- Security (audit SEC-001): "every member of the Telegram group can use the order buttons"
-- becomes opt-in. Switched off where it was on; the owner can turn it back on in Notifier, and
-- even then unlinked group members may only Confirm / mark Unreachable.
UPDATE `settings` SET `value` = json_set(`value`, '$.trust_group_members', json('false'))
WHERE `key` = 'notifications' AND json_extract(`value`, '$.trust_group_members') = 1;
