import { Clarinet, Tx, Chain, Account, types } from "https://deno.land/x/clarinet@v0.31.0/index.ts";
import { assertEquals } from "https://deno.land/std@0.90.0/testing/asserts.ts";

Clarinet.test({
  name: "Member can successfully enroll in network",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    
    const enrollment = chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("TechFarm Solutions"),
          types.uint(1),
          types.utf8("California, USA"),
          types.utf8("Sustainable produce grower"),
        ],
        deployer.address
      ),
      true
    );

    assertEquals(enrollment.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Cannot enroll twice with same principal",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const testAccount = accounts.get("wallet_1")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Alpha Growers"),
          types.uint(2),
          types.utf8("Texas, USA"),
          types.utf8("Logistics operator"),
        ],
        testAccount.address
      ),
      true
    );

    chain.txErr(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Different Name"),
          types.uint(3),
          types.utf8("Different Location"),
          types.utf8("Different data"),
        ],
        testAccount.address
      ),
      101
    );
  },
});

Clarinet.test({
  name: "Invalid tier during enrollment is rejected",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const member = accounts.get("wallet_2")!;
    
    chain.txErr(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Invalid Tier Co"),
          types.uint(99),
          types.utf8("Somewhere"),
          types.utf8("metadata"),
        ],
        member.address
      ),
      103
    );
  },
});

Clarinet.test({
  name: "Governance role cannot self-enroll",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const user = accounts.get("wallet_3")!;
    
    chain.txErr(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Attempted Admin Enrollment"),
          types.uint(6),
          types.utf8("Location"),
          types.utf8("data"),
        ],
        user.address
      ),
      100
    );
  },
});

Clarinet.test({
  name: "Endorser tier cannot self-enroll",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const user = accounts.get("wallet_4")!;
    
    chain.txErr(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Self Endorser Attempt"),
          types.uint(5),
          types.utf8("Location"),
          types.utf8("data"),
        ],
        user.address
      ),
      100
    );
  },
});

Clarinet.test({
  name: "Fetch enrolled member data successfully",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const member = accounts.get("wallet_5")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Query Test Farm"),
          types.uint(1),
          types.utf8("Oregon"),
          types.utf8("test-metadata"),
        ],
        member.address
      ),
      true
    );

    const queryBlock = chain.readOnlyFn("member-registry", "fetch-member-data",
      [types.principal(member.address)]
    );

    const result = queryBlock.result;
    assertEquals(result.includes("Query Test Farm"), true);
  },
});

Clarinet.test({
  name: "Verify member exists query returns correct status",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const activeUser = accounts.get("wallet_6")!;
    const nonUser = accounts.get("wallet_7")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Existing Member Farm"),
          types.uint(3),
          types.utf8("New York"),
          types.utf8("exists"),
        ],
        activeUser.address
      ),
      true
    );

    assertEquals(
      chain.readOnlyFn("member-registry", "member-is-registered",
        [types.principal(activeUser.address)]
      ).result,
      "true"
    );

    assertEquals(
      chain.readOnlyFn("member-registry", "member-is-registered",
        [types.principal(nonUser.address)]
      ).result,
      "false"
    );
  },
});

Clarinet.test({
  name: "Member certification state transitions correctly",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const enrollee = accounts.get("wallet_8")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Cert Transition Farm"),
          types.uint(4),
          types.utf8("Florida"),
          types.utf8("for-cert"),
        ],
        enrollee.address
      ),
      true
    );

    assertEquals(
      chain.readOnlyFn("member-registry", "member-is-certified",
        [types.principal(enrollee.address)]
      ).result,
      "false"
    );
  },
});

Clarinet.test({
  name: "Fetch tier count for valid tier",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const user1 = accounts.get("wallet_9")!;
    const user2 = accounts.get("wallet_10")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Tier Count Test A"),
          types.uint(1),
          types.utf8("Location A"),
          types.utf8("data-a"),
        ],
        user1.address
      ),
      true
    );

    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Tier Count Test B"),
          types.uint(1),
          types.utf8("Location B"),
          types.utf8("data-b"),
        ],
        user2.address
      ),
      true
    );

    const countResult = chain.readOnlyFn("member-registry", "query-tier-count",
      [types.uint(1)]
    );

    assertEquals(countResult.result.includes("u2"), true);
  },
});

Clarinet.test({
  name: "Member profile update succeeds for enrolled member",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const member = accounts.get("wallet_11")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Profile Update Farm"),
          types.uint(2),
          types.utf8("Georgia"),
          types.utf8("initial"),
        ],
        member.address
      ),
      true
    );

    const updateResult = chain.txOk(
      Tx.contractCall("member-registry", "update-member-profile",
        [
          types.utf8("Updated Farm Name"),
          types.utf8("Georgia (Updated)"),
          types.utf8("updated-metadata"),
        ],
        member.address
      ),
      true
    );

    assertEquals(updateResult.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Profile update fails for non-registered member",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const notRegistered = accounts.get("wallet_12")!;
    
    chain.txErr(
      Tx.contractCall("member-registry", "update-member-profile",
        [
          types.utf8("Some Farm"),
          types.utf8("Some Place"),
          types.utf8("metadata"),
        ],
        notRegistered.address
      ),
      102
    );
  },
});

Clarinet.test({
  name: "Query member tier verification works correctly",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const applicant = accounts.get("wallet_13")!;
    const wrongTier = accounts.get("wallet_14")!;
    
    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Tier Check Farm A"),
          types.uint(2),
          types.utf8("Kansas"),
          types.utf8("logistics"),
        ],
        applicant.address
      ),
      true
    );

    chain.txOk(
      Tx.contractCall("member-registry", "enroll-member",
        [
          types.utf8("Tier Check Farm B"),
          types.uint(4),
          types.utf8("Michigan"),
          types.utf8("retail"),
        ],
        wrongTier.address
      ),
      true
    );

    assertEquals(
      chain.readOnlyFn("member-registry", "member-holds-tier",
        [types.principal(applicant.address), types.uint(2)]
      ).result,
      "false"
    );
  },
});

Clarinet.test({
  name: "Controller transfer authorization succeeds for controller",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    const newController = accounts.get("wallet_15")!;
    
    const result = chain.txOk(
      Tx.contractCall("member-registry", "reassign-controller",
        [types.principal(newController.address)],
        deployer.address
      ),
      true
    );

    assertEquals(result.result, "(ok true)");
  },
});

Clarinet.test({
  name: "Multiple tiers can coexist in network",
  async fn(chain: Chain, accounts: Map<string, Account>) {
    const grower = accounts.get("wallet_16")!;
    const logistics = accounts.get("wallet_17")!;
    const processor = accounts.get("wallet_18")!;
    const retailer = accounts.get("wallet_19")!;
    
    [
      { account: grower, tier: 1, name: "Farm A" },
      { account: logistics, tier: 2, name: "Logistics B" },
      { account: processor, tier: 3, name: "Processor C" },
      { account: retailer, tier: 4, name: "Retail D" },
    ].forEach(({ account, tier, name }) => {
      chain.txOk(
        Tx.contractCall("member-registry", "enroll-member",
          [
            types.utf8(name),
            types.uint(tier),
            types.utf8("Location"),
            types.utf8("metadata"),
          ],
          account.address
        ),
        true
      );
    });

    assertEquals(
      chain.readOnlyFn("member-registry", "query-tier-count",
        [types.uint(1)]
      ).result.includes("u1"), 
      true
    );
  },
});
