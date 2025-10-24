;; member-registry
;;
;; Core network participation contract handling member enrollment, identity verification,
;; and access tier assignment. Members represent all actors within the agricultural ledger
;; ecosystem and must achieve verified status before performing supply chain operations.

;; Error Definitions
(define-constant ERR-UNAUTHORIZED-REQUEST (err u100))
(define-constant ERR-ENROLLMENT-EXISTS (err u101))
(define-constant ERR-MEMBER-NOT-REGISTERED (err u102))
(define-constant ERR-INVALID-TIER (err u103))
(define-constant ERR-INVALID-STATE (err u104))
(define-constant ERR-ADMIN-ONLY (err u105))
(define-constant ERR-ENDORSER-ONLY (err u106))
(define-constant ERR-BAD-REPUTATION (err u107))

;; Network Member Tiers
(define-constant TIER-GROWER u1)
(define-constant TIER-LOGISTICS u2)
(define-constant TIER-TRANSFORMATION u3)
(define-constant TIER-RETAIL u4)
(define-constant TIER-ENDORSER u5)
(define-constant TIER-GOVERNANCE u6)

;; Member Status Codes
(define-constant STATUS-APPLICANT u1)
(define-constant STATUS-CERTIFIED u2)
(define-constant STATUS-RESTRICTED u3)
(define-constant STATUS-INACTIVE u4)

;; Configuration constants
(define-constant MIN-REPUTATION u0)
(define-constant MAX-REPUTATION u100)

;; Storage definitions

;; Primary network administrator authority
(define-data-var network-controller principal tx-sender)

;; Primary registry of all enrolled members
(define-map member-records principal 
  {
    principal-id: principal,
    organization-name: (string-utf8 100),
    tier: uint,
    state: uint,
    reputation: uint,
    location-info: (string-utf8 100),
    enrollment-block: uint,
    state-modified-block: uint,
    endorser-ref: (optional principal),
    extended-data: (string-utf8 256)
  }
)

;; Endorsers authorized to verify member status
(define-map endorser-registry principal bool)

;; System administrators with governance capabilities
(define-map governance-registry principal bool)

;; Track member counts segmented by tier
(define-map tier-summary uint uint)

;; Internal Helper Functions

;; Verify caller holds administrator role
(define-private (verify-governance (caller principal))
  (default-to false (map-get? governance-registry caller))
)

;; Verify caller holds endorser role
(define-private (verify-endorser (caller principal))
  (default-to false (map-get? endorser-registry caller))
)

;; Verify caller is the network controller
(define-private (verify-controller (caller principal))
  (is-eq caller (var-get network-controller))
)

;; Validate tier is recognized by network
(define-private (tier-is-valid (tier-code uint))
  (or
    (is-eq tier-code TIER-GROWER)
    (is-eq tier-code TIER-LOGISTICS)
    (is-eq tier-code TIER-TRANSFORMATION)
    (is-eq tier-code TIER-RETAIL)
    (is-eq tier-code TIER-ENDORSER)
    (is-eq tier-code TIER-GOVERNANCE)
  )
)

;; Validate member state is recognized by network
(define-private (state-is-valid (state-code uint))
  (or
    (is-eq state-code STATUS-APPLICANT)
    (is-eq state-code STATUS-CERTIFIED)
    (is-eq state-code STATUS-RESTRICTED)
    (is-eq state-code STATUS-INACTIVE)
  )
)

;; Add member to tier count
(define-private (increment-tier-count (tier-code uint))
  (map-set tier-summary 
    tier-code 
    (+ (default-to u0 (map-get? tier-summary tier-code)) u1)
  )
)

;; Remove member from tier count
(define-private (decrement-tier-count (tier-code uint))
  (let ((existing-count (default-to u0 (map-get? tier-summary tier-code))))
    (if (> existing-count u0)
      (map-set tier-summary tier-code (- existing-count u1))
      (map-set tier-summary tier-code u0)
    )
  )
)

;; Public Query Functions

;; Fetch member enrollment record
(define-read-only (fetch-member-data (member-principal principal))
  (map-get? member-records member-principal)
)

;; Verify member exists in registry
(define-read-only (member-is-registered (member-principal principal))
  (is-some (map-get? member-records member-principal))
)

;; Check if member has achieved certified status
(define-read-only (member-is-certified (member-principal principal))
  (let ((member-data (map-get? member-records member-principal)))
    (if (is-some member-data)
      (is-eq (get state (unwrap-panic member-data)) STATUS-CERTIFIED)
      false
    )
  )
)

;; Count members at specific tier
(define-read-only (query-tier-count (tier-code uint))
  (default-to u0 (map-get? tier-summary tier-code))
)

;; Verify member holds specific tier with certified status
(define-read-only (member-holds-tier (member-principal principal) (tier-code uint))
  (let ((member-data (map-get? member-records member-principal)))
    (and
      (is-some member-data)
      (is-eq (get tier (unwrap-panic member-data)) tier-code)
      (is-eq (get state (unwrap-panic member-data)) STATUS-CERTIFIED)
    )
  )
)

;; Public Transaction Functions

;; Self-enrollment for new member
(define-public (enroll-member
    (organization-name (string-utf8 100))
    (tier-code uint)
    (location-info (string-utf8 100))
    (extended-data (string-utf8 256)))
  (let ((caller tx-sender)
        (block-timestamp (unwrap-panic (get-block-info? time (- block-height u1)))))
    (asserts! (not (member-is-registered caller)) ERR-ENROLLMENT-EXISTS)
    (asserts! (tier-is-valid tier-code) ERR-INVALID-TIER)
    (asserts! (not (or (is-eq tier-code TIER-GOVERNANCE) (is-eq tier-code TIER-ENDORSER))) ERR-UNAUTHORIZED-REQUEST)
    
    (map-set member-records caller
      {
        principal-id: caller,
        organization-name: organization-name,
        tier: tier-code,
        state: STATUS-APPLICANT,
        reputation: u50,
        location-info: location-info,
        enrollment-block: block-timestamp,
        state-modified-block: block-timestamp,
        endorser-ref: none,
        extended-data: extended-data
      }
    )
    
    (increment-tier-count tier-code)
    (ok true)
  )
)

;; Endorser verification of member enrollment
(define-public (certify-member (member-principal principal))
  (let ((caller tx-sender)
        (block-timestamp (unwrap-panic (get-block-info? time (- block-height u1)))))
    (asserts! (or (verify-endorser caller) (verify-governance caller)) ERR-ENDORSER-ONLY)
    (asserts! (member-is-registered member-principal) ERR-MEMBER-NOT-REGISTERED)
    
    (let ((member-data (unwrap-panic (map-get? member-records member-principal))))
      (asserts! (is-eq (get state member-data) STATUS-APPLICANT) ERR-INVALID-STATE)
      
      (map-set member-records member-principal
        (merge member-data 
          {
            state: STATUS-CERTIFIED,
            state-modified-block: block-timestamp,
            endorser-ref: (some caller)
          }
        )
      )
      (ok true)
    )
  )
)

;; Update member state (restrict or reactivate)
(define-public (set-member-state (member-principal principal) (new-state uint))
  (let ((caller tx-sender)
        (block-timestamp (unwrap-panic (get-block-info? time (- block-height u1)))))
    (asserts! (or (verify-endorser caller) (verify-governance caller)) ERR-ENDORSER-ONLY)
    (asserts! (member-is-registered member-principal) ERR-MEMBER-NOT-REGISTERED)
    (asserts! (state-is-valid new-state) ERR-INVALID-STATE)
    
    (let ((member-data (unwrap-panic (map-get? member-records member-principal))))
      (map-set member-records member-principal
        (merge member-data 
          {
            state: new-state,
            state-modified-block: block-timestamp
          }
        )
      )
      (ok true)
    )
  )
)

;; Member self-update of profile information
(define-public (update-member-profile
    (organization-name (string-utf8 100))
    (location-info (string-utf8 100))
    (extended-data (string-utf8 256)))
  (let ((caller tx-sender)
        (block-timestamp (unwrap-panic (get-block-info? time (- block-height u1)))))
    (asserts! (member-is-registered caller) ERR-MEMBER-NOT-REGISTERED)
    
    (let ((member-data (unwrap-panic (map-get? member-records caller))))
      (map-set member-records caller
        (merge member-data 
          {
            organization-name: organization-name,
            location-info: location-info,
            extended-data: extended-data,
            state-modified-block: block-timestamp
          }
        )
      )
      (ok true)
    )
  )
)

;; Remove endorser from authorization
(define-public (revoke-endorser (endorser-principal principal))
  (let ((caller tx-sender))
    (asserts! (verify-governance caller) ERR-ADMIN-ONLY)
    (asserts! (verify-endorser endorser-principal) ERR-UNAUTHORIZED-REQUEST)
    
    (map-delete endorser-registry endorser-principal)
    (decrement-tier-count TIER-ENDORSER)
    (ok true)
  )
)

;; Transfer controller privileges
(define-public (reassign-controller (new-controller principal))
  (let ((caller tx-sender))
    (asserts! (verify-controller caller) ERR-ADMIN-ONLY)
    (var-set network-controller new-controller)
    (ok true)
  )
)
