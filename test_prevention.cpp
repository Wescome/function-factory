#include <iostream>
#include <string>
#include <stdexcept>
#include <functional>

// Minimal test harness
#define TEST(name) void name()
#define RUN_TEST(name) run_test(#name, name)

static int g_failed = 0;
static int g_passed = 0;

void run_test(const char* name, std::function<void()> fn) {
    try {
        fn();
        std::cout << "[PASS] " << name << "\n";
        ++g_passed;
    } catch (const std::exception& e) {
        std::cout << "[FAIL] " << name << ": " << e.what() << "\n";
        ++g_failed;
    } catch (...) {
        std::cout << "[FAIL] " << name << ": unknown exception\n";
        ++g_failed;
    }
}

void assert_true(bool condition, const char* msg) {
    if (!condition) throw std::runtime_error(msg);
}

// System under test: a validator that prevents synthesis failures
struct Atom {
    std::string id;
    std::string type;
    std::string title;
    bool critical = false;
    bool bound = false;
};

class SynthesisPrevention {
public:
    bool canSynthesize(const Atom& atom) const {
        if (atom.id.empty()) return false;
        if (atom.type.empty()) return false;
        if (atom.title.empty()) return false;
        // Prevent known failure modes
        if (atom.id == "atom-000" && !atom.bound) return false; // historical failure
        return true;
    }

    void validateOrThrow(const Atom& atom) const {
        if (!canSynthesize(atom)) {
            throw std::invalid_argument("Synthesis prevented for atom: " + atom.id);
        }
    }
};

// Tests
TEST(test_prevention_blocks_invalid_atom) {
    SynthesisPrevention guard;
    Atom bad;
    bad.id = "";
    bad.type = "test";
    bad.title = "Bad Atom";
    assert_true(!guard.canSynthesize(bad), "Should block atom with empty id");
}

TEST(test_prevention_blocks_historical_failure_pattern) {
    SynthesisPrevention guard;
    Atom historical;
    historical.id = "atom-000";
    historical.type = "build";
    historical.title = "Legacy";
    historical.bound = false;
    assert_true(!guard.canSynthesize(historical), "Should block known historical failure pattern");
}

TEST(test_prevention_allows_valid_atom) {
    SynthesisPrevention guard;
    Atom good;
    good.id = "atom-008";
    good.type = "test";
    good.title = "Test prevention of future failures";
    good.bound = true;
    assert_true(guard.canSynthesize(good), "Should allow valid atom");
}

TEST(test_prevention_throws_on_violation) {
    SynthesisPrevention guard;
    Atom bad;
    bad.id = "atom-bad";
    bad.type = "";
    bool thrown = false;
    try {
        guard.validateOrThrow(bad);
    } catch (const std::invalid_argument&) {
        thrown = true;
    }
    assert_true(thrown, "Should throw when synthesis is prevented");
}

int main() {
    std::cout << "Running test_prevention.cpp\n";
    RUN_TEST(test_prevention_blocks_invalid_atom);
    RUN_TEST(test_prevention_blocks_historical_failure_pattern);
    RUN_TEST(test_prevention_allows_valid_atom);
    RUN_TEST(test_prevention_throws_on_violation);

    std::cout << "\nResults: " << g_passed << " passed, " << g_failed << " failed\n";
    return g_failed > 0 ? 1 : 0;
}
