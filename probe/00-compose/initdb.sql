-- If this table exists, the bind mount from the named-volume workspace worked.
CREATE TABLE bind_mount_proof (note text);
INSERT INTO bind_mount_proof VALUES ('initdb script was readable by the inner daemon');
