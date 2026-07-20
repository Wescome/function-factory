import { describe, it, expect } from "vitest";
import { env, runInDurableObject, evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";

function stub() {
  const id = (env as any).TESTAGENT.idFromName("verify-1");
  return (env as any).TESTAGENT.get(id);
}
function throwStub() {
  const id = (env as any).TESTAGENT.idFromName("verify-throw-1");
  return (env as any).TESTAGENT.get(id);
}

describe("onFiberRecovered: true eviction vs clean throw", () => {
  it("TRUE eviction (evictDurableObject) + alarm -> onFiberRecovered fires", async () => {
    const s = stub();

    // 1) start the never-ending fiber, fire-and-forget
    const started = await runInDurableObject(s, (d: any) => d.startNeverEndingFiber());
    expect(started).toBe(true);

    // small delay to let the fiber's synchronous stash/insert land before eviction
    await new Promise((r) => setTimeout(r, 20));

    const rowsBeforeEviction = await runInDurableObject(s, (d: any) => d.activeFiberRows());
    console.log("cf_agents_runs rows BEFORE eviction:", rowsBeforeEviction);

    // 2) TRUE eviction: tears down the instance, wipes in-memory state,
    //    preserves durable storage (per the documented contract).
    await evictDurableObject(s);

    // 3) force the alarm to run NOW (in real prod this fires on its own via keepAlive)
    const alarmRan = await runDurableObjectAlarm(s);
    console.log("alarm ran:", alarmRan);

    // 4) fresh stub, same id -> check whether onFiberRecovered actually fired
    const fresh = stub();
    const result = await runInDurableObject(fresh, (d: any) => d.wasRecovered());
    console.log("wasRecovered:", result);

    expect(result.recovered).toBe(true);
    expect(JSON.parse(result.snapshot ?? "null")).toMatchObject({ marker: "hello-from-fiber" });
  });

  it("CONTROL: a clean throw inside runFiber leaves NOTHING to recover", async () => {
    const s = throwStub();
    const outcome = await runInDurableObject(s, (d: any) => d.startThrowingFiber());
    console.log("throwing-fiber outcome:", outcome);
    expect(outcome).toBe("threw:SIMULATED_INTERRUPT");

    // No eviction happened here at all -- the instance is still alive and its
    // own finally already ran. The claim: recovery never fires for this path.
    const alarmRan = await runDurableObjectAlarm(s);
    console.log("alarm ran (throw case):", alarmRan);

    const result = await runInDurableObject(s, (d: any) => d.wasRecovered());
    console.log("wasRecovered (throw case):", result);
    expect(result.recovered).toBe(false);

    const rows = await runInDurableObject(s, (d: any) => d.activeFiberRows());
    expect(rows).toBe(0); // tracking row was deleted in the finally, as verified from source
  });
});
