-- 015_appointment_services.sql
-- Permite vincular varios servicos ao mesmo horario reservado.

CREATE TABLE appointment_services (
    appointment_id BIGINT UNSIGNED NOT NULL,
    service_id     BIGINT UNSIGNED NOT NULL,
    sort_order     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (appointment_id, service_id),
    KEY idx_appointment_services_service (service_id),
    CONSTRAINT fk_appointment_services_appointment FOREIGN KEY (appointment_id)
        REFERENCES appointments (id) ON DELETE CASCADE,
    CONSTRAINT fk_appointment_services_service FOREIGN KEY (service_id)
        REFERENCES services (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO appointment_services (appointment_id, service_id, sort_order)
SELECT id, service_id, 0
FROM appointments;
