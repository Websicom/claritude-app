begin;

update storage.buckets
set file_size_limit = 131072,
    allowed_mime_types = array['image/webp']
where id = 'avatars';

commit;
