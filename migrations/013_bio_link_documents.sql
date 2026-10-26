-- Permite anexar documentos PDF ou DOCX aos botões da bio.
ALTER TABLE bio_links
    ADD COLUMN file_data LONGTEXT NULL AFTER type,
    ADD COLUMN file_name VARCHAR(255) NULL AFTER file_data,
    ADD COLUMN file_mime VARCHAR(127) NULL AFTER file_name;
