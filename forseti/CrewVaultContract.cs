// NIGHTFABRIC — crew vault access policy.
//
// This C# runs INSIDE EVERY ORK, in a sandboxed VmHost, on every encrypt and
// every decrypt of a crew-vault drop. A majority of ORKs must independently
// reach Allow. There is no bypass: not by the game server, not by the database,
// not by an admin, not by whoever owns the box the game is running on.
//
// Two rules:
//   1. The executor's doken must carry the `crew-vault-access` realm role.
//      Revoking that role revokes the ability to read drops that were sealed
//      BEFORE the revocation — ordinary encryption cannot do that, because the
//      ciphertext is already out there and the key is already known.
//   2. A drop tagged `DecryptTimeLock:<unix-seconds>` cannot be opened before
//      that time. Not "the UI hides it" — the network refuses to participate,
//      so the key is never reassembled. That is the job-window mechanic.
//
// Pre-flight: templates/forseti-compile-harness/check.sh CrewVaultContract.cs
// A shape error here surfaces as VmHost.CompileFailed at request time, AFTER an
// enclave operator approval has been spent.

using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true, Description = "Realm role required to open a crew drop")]
    public string Role { get; set; }

    // Threaded from ValidateData: ctx.Data exists only on DataContext.
    private bool _isEncrypt = false;
    private List<string> _tags = new();

    public PolicyDecision ValidateData(DataContext ctx)
    {
        // Branch on request type FIRST — encrypt and decrypt have different layouts.
        if (ctx.RequestId == "PolicyEnabledEncryption:1") _isEncrypt = true;
        else if (ctx.RequestId == "PolicyEnabledDecryption:1") _isEncrypt = false;
        else return PolicyDecision.Deny("Crew vault handles encryption/decryption only");

        // Refuse a policy shape this contract was not written for. Without this,
        // a policy that skipped executor validation would still bind to us.
        if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE)
            return PolicyDecision.Deny("Crew vault policy must be PRIVATE");

        // ctx.Data is a NESTED ReadOnlyMemory<byte>. Tags begin at index 2 for
        // encryption and index 3 for decryption.
        ReadOnlyMemory<byte> data = ctx.Data;
        if (_isEncrypt)
        {
            if (!data.TryGetValue(1, out var first))
                return PolicyDecision.Deny("Malformed encryption payload");
            for (int i = 2; first.TryGetValue(i, out var tag); i++)
                _tags.Add(Encoding.UTF8.GetString(tag.Span));
        }
        else
        {
            if (!data.TryGetValue(0, out var first))
                return PolicyDecision.Deny("Malformed decryption payload");
            for (int i = 3; first.TryGetValue(i, out var tag); i++)
                _tags.Add(Encoding.UTF8.GetString(tag.Span));
        }

        if (_tags.Count == 0)
            return PolicyDecision.Deny("At least one data tag is required");

        // The time lock. Enforced on decryption only — sealing a future drop is
        // always allowed; opening it early is not.
        if (!_isEncrypt)
        {
            long now = Utils.GetEpochSeconds();
            for (int i = 0; i < _tags.Count; i++)
            {
                string t = _tags[i];
                if (!t.StartsWith("DecryptTimeLock:")) continue;

                long until;
                if (!long.TryParse(t.Substring("DecryptTimeLock:".Length), out until))
                    return PolicyDecision.Deny("Malformed time lock tag");

                if (now < until)
                {
                    return PolicyDecision.Deny(
                        "Drop is time-locked for another " + (until - now) + "s");
                }
            }
        }

        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);
        // 2-arg RequireRole = realm role. Note this is NOT a `_tide_*` role:
        // those are voucher gates that fund the ORK operation, and using one
        // here would be an authorization check against the wrong thing.
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, Role);
    }
}
