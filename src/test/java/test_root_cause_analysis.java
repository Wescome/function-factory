import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for root cause analysis of atom synthesis failures.
 * Verifies that the system can correctly identify root causes
 * from synthesis failure reports.
 */
class RootCauseAnalysisTest {

    @Test
    @DisplayName("Should identify missing dependency as root cause")
    void shouldIdentifyMissingDependencyAsRootCause() {
        SynthesisFailure failure = new SynthesisFailure(
            "atom-003",
            SynthesisFailure.Reason.DEPENDENCY_NOT_FOUND,
            "Required atom 'atom-deps-001' not found in registry"
        );

        RootCause cause = RootCauseAnalyzer.analyze(failure);

        assertNotNull(cause);
        assertEquals(RootCause.Category.MISSING_DEPENDENCY, cause.getCategory());
        assertTrue(cause.getDescription().contains("atom-deps-001"));
        assertEquals("atom-003", cause.getSourceAtomId());
    }

    @Test
    @DisplayName("Should identify circular reference as root cause")
    void shouldIdentifyCircularReferenceAsRootCause() {
        SynthesisFailure failure = new SynthesisFailure(
            "atom-005",
            SynthesisFailure.Reason.CIRCULAR_DEPENDENCY,
            "Cycle detected: atom-005 -> atom-006 -> atom-005"
        );

        RootCause cause = RootCauseAnalyzer.analyze(failure);

        assertNotNull(cause);
        assertEquals(RootCause.Category.CIRCULAR_REFERENCE, cause.getCategory());
        assertEquals("atom-005", cause.getSourceAtomId());
    }

    @Test
    @DisplayName("Should identify invalid binding as root cause")
    void shouldIdentifyInvalidBindingAsRootCause() {
        SynthesisFailure failure = new SynthesisFailure(
            "atom-007",
            SynthesisFailure.Reason.INVALID_BINDING,
            "Binding type 'unknown' is not supported for atom implementation"
        );

        RootCause cause = RootCauseAnalyzer.analyze(failure);

        assertNotNull(cause);
        assertEquals(RootCause.Category.INVALID_CONFIGURATION, cause.getCategory());
        assertTrue(cause.getDescription().contains("unknown"));
    }

    @Test
    @DisplayName("Should return unknown category when failure reason is unrecognized")
    void shouldReturnUnknownWhenNoRecognizedCauseFound() {
        SynthesisFailure failure = new SynthesisFailure(
            "atom-099",
            SynthesisFailure.Reason.UNKNOWN,
            "Unexpected error during synthesis"
        );

        RootCause cause = RootCauseAnalyzer.analyze(failure);

        assertNotNull(cause);
        assertEquals(RootCause.Category.UNKNOWN, cause.getCategory());
    }

    @Test
    @DisplayName("Should extract deepest cause from chained failures")
    void shouldExtractDeepestCauseFromChainedFailures() {
        SynthesisFailure inner = new SynthesisFailure(
            "atom-inner",
            SynthesisFailure.Reason.TIMEOUT,
            "Synthesis timed out after 30s"
        );
        SynthesisFailure outer = new SynthesisFailure(
            "atom-outer",
            SynthesisFailure.Reason.DEPENDENCY_FAILED,
            "Dependency synthesis failed",
            inner
        );

        RootCause cause = RootCauseAnalyzer.analyze(outer);

        assertNotNull(cause);
        assertEquals("atom-inner", cause.getSourceAtomId());
        assertEquals(RootCause.Category.TIMEOUT, cause.getCategory());
    }
}
