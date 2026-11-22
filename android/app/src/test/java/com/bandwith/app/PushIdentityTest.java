package com.bandwith.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Codex review #287 round 5 (B1): a push tagged for another account never shows. */
public class PushIdentityTest {
    @Test
    public void untaggedPushesWorkAsBefore() {
        assertEquals(PushIdentity.Decision.LEGACY, PushIdentity.decide(null, "alice"));
        assertEquals(PushIdentity.Decision.LEGACY, PushIdentity.decide(null, null));
    }

    @Test
    public void onlyTheSignedInAccountSeesItsPush() {
        assertEquals(PushIdentity.Decision.SHOW, PushIdentity.decide("alice", "alice"));
        assertEquals(PushIdentity.Decision.DROP, PushIdentity.decide("alice", "bob"));
    }

    @Test
    public void signedOutShowsNothingTagged() {
        assertEquals(PushIdentity.Decision.DROP, PushIdentity.decide("alice", null));
        assertEquals(PushIdentity.Decision.DROP, PushIdentity.decide("alice", ""));
        assertEquals(PushIdentity.Decision.DROP, PushIdentity.decide("", "alice"));
    }
}
