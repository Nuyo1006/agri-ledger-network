;; ledger-operations
;;
;; Product ledger management system enabling agricultural commodities to be tracked
;; through the supply chain. Manages product creation, custody transitions, quality 
;; certifications, and maintains immutable audit trails of all operations.

;; Error codes
(define-constant ERR-UNAUTHORIZED-ACTION (err u100))
(define-constant ERR-INVALID-COMMODITY (err u101))
(define-constant ERR-COMMODITY-REGISTERED (err u102))
(define-constant ERR-NOT-CUSTODIAN (err u103))
(define-constant ERR-INVALID-PARTICIPANT (err u104))
(define-constant ERR-COMMODITY-TRANSFERRED (err u105))
(define-constant ERR-UNKNOWN-CERTIFIER (err u106))
(define-constant ERR-CERTIFICATION-PRESENT (err u107))
(define-constant ERR-CERT-NOT-FOUND (err u108))

;; Data tracking
(define-data-var commodity-sequence uint u0)

;; Core commodity records
(define-map commodity-ledger 
  { commodity-id: uint }
  {
    originating-grower: principal,
    commodity-class: (string-ascii 50),
    harvest-timestamp: uint,
    current-handler: principal,
    operational-state: (string-ascii 20),
    transferred: bool
  }
)

;; Quality certification records
(define-map commodity-qualifications
  { commodity-id: uint, qual-category: (string-ascii 30) }
  {
    qualification-issuer: principal,
    issued-at-block: uint,
    expiration-block: uint,
    certification-notes: (string-utf8 200)
  }
)

;; Audit trail entries
(define-map commodity-audit-log
  { commodity-id: uint, operation-index: uint }
  {
    operation-timestamp: uint,
    operation-category: (string-ascii 30),
    operator: principal,
    operation-notes: (string-utf8 200),
    geographic-location: (optional (string-ascii 100))
  }
)

;; Audit log size tracking per commodity
(define-map commodity-audit-size
  { commodity-id: uint }
  { operations-count: uint }
)

;; Supply chain participant registry
(define-map supply-chain-partners
  { partner-id: principal }
  {
    partner-classification: (string-ascii 30),
    authorized-status: bool,
    enrollment-block: uint
  }
)

;; Authorized certification bodies
(define-map certification-bodies
  { body-id: principal }
  {
    body-designation: (string-ascii 50),
    supported-qualifications: (list 10 (string-ascii 30)),
    operational-status: bool
  }
)

;; Private helper functions

;; Generate new commodity identifier
(define-private (generate-commodity-id)
  (let ((current-id (var-get commodity-sequence)))
    (var-set commodity-sequence (+ current-id u1))
    current-id
  )
)

;; Validate supply chain partner authorization
(define-private (partner-authorized (partner principal))
  (match (map-get? supply-chain-partners { partner-id: partner })
    partner-record (and (get authorized-status partner-record) true)
    false
  )
)

;; Verify custody rights over commodity
(define-private (has-custody (commodity-id uint) (verifying-principal principal))
  (match (map-get? commodity-ledger { commodity-id: commodity-id })
    commodity-record (is-eq (get current-handler commodity-record) verifying-principal)
    false
  )
)

;; Log supply chain event
(define-private (record-operation (commodity-id uint) (op-category (string-ascii 30)) (op-notes (string-utf8 200)) (location (optional (string-ascii 100))))
  (let (
    (audit-record (default-to { operations-count: u0 } (map-get? commodity-audit-size { commodity-id: commodity-id })))
    (next-index (get operations-count audit-record))
  )
    ;; Increment operation count
    (map-set commodity-audit-size 
      { commodity-id: commodity-id }
      { operations-count: (+ next-index u1) }
    )
    
    ;; Store operation entry
    (map-set commodity-audit-log
      { commodity-id: commodity-id, operation-index: next-index }
      {
        operation-timestamp: block-height,
        operation-category: op-category,
        operator: tx-sender,
        operation-notes: op-notes,
        geographic-location: location
      }
    )
    (ok next-index)
  )
)

;; Verify certification authority supports quality type
(define-private (body-supports-qualification (authority principal) (qual-category (string-ascii 30)))
  (match (map-get? certification-bodies { body-id: authority })
    authority-record (and 
                    (get operational-status authority-record)
                    (is-some (index-of (get supported-qualifications authority-record) qual-category))
                   )
    false
  )
)

;; Public interface functions

;; Register supply chain participant
(define-public (register-supply-partner (classification (string-ascii 30)))
  (begin
    (map-set supply-chain-partners
      { partner-id: tx-sender }
      {
        partner-classification: classification,
        authorized-status: true,
        enrollment-block: block-height
      }
    )
    (ok tx-sender)
  )
)

;; Register certification authority
(define-public (register-cert-authority (body-name (string-ascii 50)) (qualifications (list 10 (string-ascii 30))))
  (begin
    (map-set certification-bodies
      { body-id: tx-sender }
      {
        body-designation: body-name,
        supported-qualifications: qualifications,
        operational-status: true
      }
    )
    (ok tx-sender)
  )
)

;; Create new product entry in ledger
(define-public (create-commodity (commodity-class (string-ascii 50)) (harvest-timestamp uint))
  (let (
    (new-commodity-id (generate-commodity-id))
  )
    (map-set commodity-ledger
      { commodity-id: new-commodity-id }
      {
        originating-grower: tx-sender,
        commodity-class: commodity-class,
        harvest-timestamp: harvest-timestamp,
        current-handler: tx-sender,
        operational-state: "active",
        transferred: false
      }
    )
    
    ;; Initialize audit trail
    (map-set commodity-audit-size 
      { commodity-id: new-commodity-id }
      { operations-count: u0 }
    )
    
    ;; Record creation event
    (record-operation new-commodity-id "origin-registration" (concat "Commodity created: " commodity-class) none)
    
    (ok new-commodity-id)
  )
)

;; Transfer product custody between handlers
(define-public (exchange-custody (commodity-id uint) (receiving-handler principal) (transfer-notes (string-utf8 200)) (location (optional (string-ascii 100))))
  (let (
    (commodity (map-get? commodity-ledger { commodity-id: commodity-id }))
  )
    (asserts! (is-some commodity) ERR-INVALID-COMMODITY)
    (asserts! (has-custody commodity-id tx-sender) ERR-NOT-CUSTODIAN)
    (asserts! (partner-authorized receiving-handler) ERR-INVALID-PARTICIPANT)
    (asserts! (not (get transferred (unwrap-panic commodity))) ERR-COMMODITY-TRANSFERRED)
    
    ;; Update handler
    (map-set commodity-ledger
      { commodity-id: commodity-id }
      (merge (unwrap-panic commodity) { current-handler: receiving-handler })
    )
    
    ;; Record operation
    (record-operation commodity-id "handler-exchange" transfer-notes location)
    
    (ok true)
  )
)

;; Attach quality certification to commodity
(define-public (issue-qualification (commodity-id uint) (qual-category (string-ascii 30)) (expiration-block uint) (certification-notes (string-utf8 200)))
  (let (
    (commodity (map-get? commodity-ledger { commodity-id: commodity-id }))
    (existing-qualification (map-get? commodity-qualifications { commodity-id: commodity-id, qual-category: qual-category }))
  )
    (asserts! (is-some commodity) ERR-INVALID-COMMODITY)
    (asserts! (body-supports-qualification tx-sender qual-category) ERR-UNKNOWN-CERTIFIER)
    (asserts! (is-none existing-qualification) ERR-CERTIFICATION-PRESENT)
    
    ;; Store certification
    (map-set commodity-qualifications
      { commodity-id: commodity-id, qual-category: qual-category }
      {
        qualification-issuer: tx-sender,
        issued-at-block: block-height,
        expiration-block: expiration-block,
        certification-notes: certification-notes
      }
    )
    
    ;; Log certification
    (record-operation commodity-id "quality-certification" 
      (concat (concat "Quality assurance added: " qual-category) (concat " - " certification-notes)) 
      none
    )
    
    (ok true)
  )
)

;; Record handling activity for commodity
(define-public (log-operation (commodity-id uint) (op-category (string-ascii 30)) (op-notes (string-utf8 200)) (location (optional (string-ascii 100))))
  (let (
    (commodity (map-get? commodity-ledger { commodity-id: commodity-id }))
  )
    (asserts! (is-some commodity) ERR-INVALID-COMMODITY)
    (asserts! (partner-authorized tx-sender) ERR-UNAUTHORIZED-ACTION)
    (asserts! (has-custody commodity-id tx-sender) ERR-NOT-CUSTODIAN)
    
    ;; Record the activity
    (record-operation commodity-id op-category op-notes location)
    
    (ok true)
  )
)

;; Mark commodity as finalized (end of chain)
(define-public (finalize-commodity (commodity-id uint) (completion-notes (string-utf8 200)) (location (optional (string-ascii 100))))
  (let (
    (commodity (map-get? commodity-ledger { commodity-id: commodity-id }))
  )
    (asserts! (is-some commodity) ERR-INVALID-COMMODITY)
    (asserts! (has-custody commodity-id tx-sender) ERR-NOT-CUSTODIAN)
    (asserts! (not (get transferred (unwrap-panic commodity))) ERR-COMMODITY-TRANSFERRED)
    
    ;; Update state
    (map-set commodity-ledger
      { commodity-id: commodity-id }
      (merge (unwrap-panic commodity) { operational-state: "finalized", transferred: true })
    )
    
    ;; Record finalization
    (record-operation commodity-id "finalization" completion-notes location)
    
    (ok true)
  )
)

;; Query Interface Functions

;; Retrieve commodity information
(define-read-only (retrieve-commodity (commodity-id uint))
  (map-get? commodity-ledger { commodity-id: commodity-id })
)

;; Retrieve certification for commodity
(define-read-only (retrieve-qualification (commodity-id uint) (qual-category (string-ascii 30)))
  (map-get? commodity-qualifications { commodity-id: commodity-id, qual-category: qual-category })
)

;; Get operation count for commodity
(define-read-only (retrieve-operation-count (commodity-id uint))
  (default-to { operations-count: u0 } (map-get? commodity-audit-size { commodity-id: commodity-id }))
)

;; Get specific operation from audit trail
(define-read-only (retrieve-operation (commodity-id uint) (operation-index uint))
  (map-get? commodity-audit-log { commodity-id: commodity-id, operation-index: operation-index })
)

;; Get partner information
(define-read-only (retrieve-partner (partner principal))
  (map-get? supply-chain-partners { partner-id: partner })
)

;; Get certification authority information
(define-read-only (retrieve-cert-authority (authority principal))
  (map-get? certification-bodies { body-id: authority })
)

;; Validate handler custody status
(define-read-only (validate-custody (commodity-id uint) (handler principal))
  (has-custody commodity-id handler)
)
