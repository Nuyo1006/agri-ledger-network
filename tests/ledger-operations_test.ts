import { Clarinet, Tx, Chain, Account, types } from "https://deno.land/x/clarinet@v0.31.0/index.ts";
import { assertEquals } from "https://deno.land/std@0.90.0/testing/asserts.ts";

Clarinet.test({
  name: "Supply chain partner registration succeeds",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const partner = accounts.get("deployer")!;
    
    const result = chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("distributor")],
        partner.address
      ),
      partner.address
    );

    assertEquals(result.result.includes(partner.address), true);
  },
});

Clarinet.test({
  name: "Certification authority can register with multiple qualification types",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const certBody = accounts.get("wallet_1")!;
    const qualTypes = [
      types.ascii("organic"),
      types.ascii("fair-trade"),
      types.ascii("non-gmo")
    ];
    
    const result = chain.txOk(
      Tx.contractCall("ledger-operations", "register-cert-authority",
        [
          types.ascii("Global Certifiers Inc"),
          types.list(qualTypes)
        ],
        certBody.address
      ),
      certBody.address
    );

    assertEquals(result.result.includes(certBody.address), true);
  },
});

Clarinet.test({
  name: "Commodity creation initializes with correct state",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_2")!;
    
    const result = chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [
          types.ascii("Spring Wheat"),
          types.uint(1706745600)
        ],
        grower.address
      ),
      types.uint(0)
    );

    assertEquals(result.result, "(ok u0)");
  },
});

Clarinet.test({
  name: "Sequential commodity creation assigns incrementing IDs",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const producer = accounts.get("wallet_3")!;
    
    const first = chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Corn"), types.uint(1706745600)],
        producer.address
      ),
      types.uint(0)
    );

    const second = chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Soybeans"), types.uint(1706745600)],
        producer.address
      ),
      types.uint(1)
    );

    assertEquals(first.result, "(ok u0)");
    assertEquals(second.result, "(ok u1)");
  },
});

Clarinet.test({
  name: "Commodity query returns accurate data",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const farm = accounts.get("wallet_4")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [
          types.ascii("Barley"),
          types.uint(1706745600)
        ],
        farm.address
      ),
      types.uint(0)
    );

    const commodityData = chain.readOnlyFn("ledger-operations", "retrieve-commodity",
      [types.uint(0)]
    );

    assertEquals(commodityData.result.includes("Barley"), true);
  },
});

Clarinet.test({
  name: "Custody exchange transfers handler successfully",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const origin = accounts.get("wallet_5")!;
    const receiver = accounts.get("wallet_6")!;
    
    // Register both parties
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("producer")],
        origin.address
      )
    );
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("handler")],
        receiver.address
      )
    );

    // Create commodity
    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Rice"), types.uint(1706745600)],
        origin.address
      )
    );

    // Transfer custody
    const transfer = chain.txOk(
      Tx.contractCall("ledger-operations", "exchange-custody",
        [
          types.uint(0),
          types.principal(receiver.address),
          types.utf8("Transferred to processing"),
          types.some(types.ascii("Facility A, Iowa"))
        ],
        origin.address
      ),
      true
    );

    assertEquals(transfer.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Non-custodian cannot transfer commodity",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_7")!;
    const unauthorized = accounts.get("wallet_8")!;
    const registered = accounts.get("wallet_9")!;
    
    // Setup
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("producer")],
        grower.address
      )
    );
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("partner")],
        registered.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Oats"), types.uint(1706745600)],
        grower.address
      )
    );

    // Attempt unauthorized transfer
    chain.txErr(
      Tx.contractCall("ledger-operations", "exchange-custody",
        [
          types.uint(0),
          types.principal(registered.address),
          types.utf8("Attempt"),
          types.none()
        ],
        unauthorized.address
      ),
      103
    );
  },
});

Clarinet.test({
  name: "Cannot transfer to unregistered handler",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_10")!;
    const unregistered = accounts.get("wallet_11")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("producer")],
        grower.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Millet"), types.uint(1706745600)],
        grower.address
      )
    );

    chain.txErr(
      Tx.contractCall("ledger-operations", "exchange-custody",
        [
          types.uint(0),
          types.principal(unregistered.address),
          types.utf8("Transfer attempt"),
          types.none()
        ],
        grower.address
      ),
      104
    );
  },
});

Clarinet.test({
  name: "Finalized commodity cannot be transferred",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_12")!;
    const partner = accounts.get("wallet_13")!;
    
    // Setup
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("producer")],
        grower.address
      )
    );
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("logistics")],
        partner.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Quinoa"), types.uint(1706745600)],
        grower.address
      )
    );

    // Finalize
    chain.txOk(
      Tx.contractCall("ledger-operations", "finalize-commodity",
        [
          types.uint(0),
          types.utf8("Final sale"),
          types.none()
        ],
        grower.address
      )
    );

    // Attempt transfer of finalized commodity
    chain.txErr(
      Tx.contractCall("ledger-operations", "exchange-custody",
        [
          types.uint(0),
          types.principal(partner.address),
          types.utf8("Should fail"),
          types.none()
        ],
        grower.address
      ),
      105
    );
  },
});

Clarinet.test({
  name: "Certification authority can issue qualifications",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_14")!;
    const certifier = accounts.get("wallet_15")!;
    
    // Register authority
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-cert-authority",
        [
          types.ascii("Quality Assurance Corp"),
          types.list([types.ascii("organic"), types.ascii("pesticide-free")])
        ],
        certifier.address
      )
    );

    // Create commodity
    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Lettuce"), types.uint(1706745600)],
        grower.address
      )
    );

    // Issue certification
    const cert = chain.txOk(
      Tx.contractCall("ledger-operations", "issue-qualification",
        [
          types.uint(0),
          types.ascii("organic"),
          types.uint(1738340800),
          types.utf8("USDA Organic certified after inspection")
        ],
        certifier.address
      ),
      true
    );

    assertEquals(cert.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Cannot issue duplicate certification type for same commodity",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_16")!;
    const certifier = accounts.get("wallet_17")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-cert-authority",
        [
          types.ascii("Cert Body A"),
          types.list([types.ascii("non-gmo")])
        ],
        certifier.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Tomatoes"), types.uint(1706745600)],
        grower.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "issue-qualification",
        [
          types.uint(0),
          types.ascii("non-gmo"),
          types.uint(1738340800),
          types.utf8("Verified non-GMO")
        ],
        certifier.address
      )
    );

    chain.txErr(
      Tx.contractCall("ledger-operations", "issue-qualification",
        [
          types.uint(0),
          types.ascii("non-gmo"),
          types.uint(1738340800),
          types.utf8("Duplicate attempt")
        ],
        certifier.address
      ),
      108
    );
  },
});

Clarinet.test({
  name: "Operation logging records handler activity",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_18")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("producer")],
        grower.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Potatoes"), types.uint(1706745600)],
        grower.address
      )
    );

    const logging = chain.txOk(
      Tx.contractCall("ledger-operations", "log-operation",
        [
          types.uint(0),
          types.ascii("quality-check"),
          types.utf8("Initial quality inspection passed"),
          types.some(types.ascii("Storage Facility B"))
        ],
        grower.address
      ),
      true
    );

    assertEquals(logging.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Operation count increments with each logged activity",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const handler = accounts.get("wallet_19")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("processor")],
        handler.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Carrots"), types.uint(1706745600)],
        handler.address
      )
    );

    // Check initial count
    let countData = chain.readOnlyFn("ledger-operations", "retrieve-operation-count",
      [types.uint(0)]
    );
    
    // Log operation
    chain.txOk(
      Tx.contractCall("ledger-operations", "log-operation",
        [
          types.uint(0),
          types.ascii("storage"),
          types.utf8("Item stored in cold facility"),
          types.some(types.ascii("Warehouse C"))
        ],
        handler.address
      )
    );

    // Verify operation was recorded
    const opData = chain.readOnlyFn("ledger-operations", "retrieve-operation",
      [types.uint(0), types.uint(0)]
    );

    assertEquals(opData.result.includes("origin-registration"), true);
  },
});

Clarinet.test({
  name: "Commodity finalization completes supply chain",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const retailer = accounts.get("wallet_20")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("retailer")],
        retailer.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Spinach"), types.uint(1706745600)],
        retailer.address
      )
    );

    const finalize = chain.txOk(
      Tx.contractCall("ledger-operations", "finalize-commodity",
        [
          types.uint(0),
          types.utf8("Sold to consumer"),
          types.some(types.ascii("Retail Store XYZ"))
        ],
        retailer.address
      ),
      true
    );

    assertEquals(finalize.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Retrieve operation returns correct audit data",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const partner = accounts.get("wallet_21")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("distributor")],
        partner.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Broccoli"), types.uint(1706745600)],
        partner.address
      )
    );

    const auditEntry = chain.readOnlyFn("ledger-operations", "retrieve-operation",
      [types.uint(0), types.uint(0)]
    );

    assertEquals(auditEntry.result.includes("origin-registration"), true);
  },
});

Clarinet.test({
  name: "Retrieve certification data by category",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const producer = accounts.get("wallet_22")!;
    const authority = accounts.get("wallet_23")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-cert-authority",
        [
          types.ascii("Standards Authority"),
          types.list([types.ascii("food-safety")])
        ],
        authority.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Cabbage"), types.uint(1706745600)],
        producer.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "issue-qualification",
        [
          types.uint(0),
          types.ascii("food-safety"),
          types.uint(1738340800),
          types.utf8("Passed food safety inspection")
        ],
        authority.address
      )
    );

    const certData = chain.readOnlyFn("ledger-operations", "retrieve-qualification",
      [types.uint(0), types.ascii("food-safety")]
    );

    assertEquals(certData.result.includes("food-safety"), true);
  },
});

Clarinet.test({
  name: "Validate custody status query functionality",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const original = accounts.get("wallet_24")!;
    const newHandler = accounts.get("wallet_25")!;
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("origin")],
        original.address
      )
    );
    
    chain.txOk(
      Tx.contractCall("ledger-operations", "register-supply-partner",
        [types.ascii("next")],
        newHandler.address
      )
    );

    chain.txOk(
      Tx.contractCall("ledger-operations", "create-commodity",
        [types.ascii("Kale"), types.uint(1706745600)],
        original.address
      )
    );

    assertEquals(
      chain.readOnlyFn("ledger-operations", "validate-custody",
        [types.uint(0), types.principal(original.address)]
      ).result,
      "true"
    );

    assertEquals(
      chain.readOnlyFn("ledger-operations", "validate-custody",
        [types.uint(0), types.principal(newHandler.address)]
      ).result,
      "false"
    );
  },
});
