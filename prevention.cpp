// prevention.cpp
// Implements a system to address root causes and prevent future atom synthesis failures.

#include <algorithm>
#include <chrono>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace factory {

enum class FailureType {
    UNKNOWN,
    INVALID_BINDING,
    MISSING_DEPENDENCY,
    CIRCULAR_REFERENCE,
    TIMEOUT,
    VALIDATION_ERROR,
    EXECUTION_ERROR
};

struct AtomBinding {
    std::string type;
    std::string language;
    std::string target;
};

struct AtomSpec {
    std::string id;
    std::string type;
    std::string title;
    std::string description;
    AtomBinding binding;
    bool critical = false;
};

struct SynthesisFailure {
    std::string atomId;
    FailureType type;
    std::string message;
    std::chrono::system_clock::time_point timestamp;
};

struct RootCause {
    FailureType failureType;
    std::string description;
    std::vector<std::string> contributingFactors;
};

struct PreventiveMeasure {
    std::string id;
    std::string description;
    std::function<bool(const AtomSpec&)> check;
};

class RootCauseAnalyzer {
public:
    RootCause analyze(const SynthesisFailure& failure) {
        RootCause cause;
        cause.failureType = failure.type;
        switch (failure.type) {
            case FailureType::INVALID_BINDING:
                cause.description = "Binding specification is malformed or unsupported";
                cause.contributingFactors = {"missing language", "undefined target", "incorrect binding type"};
                break;
            case FailureType::MISSING_DEPENDENCY:
                cause.description = "Required dependency atom not found or not synthesized";
                cause.contributingFactors = {"incomplete work graph", "race condition in ordering"};
                break;
            case FailureType::CIRCULAR_REFERENCE:
                cause.description = "Circular dependency detected in atom graph";
                cause.contributingFactors = {"improper graph traversal", "missing invariant checks"};
                break;
            case FailureType::TIMEOUT:
                cause.description = "Atom synthesis exceeded maximum allowed duration";
                cause.contributingFactors = {"infinite loop risk", "resource starvation"};
                break;
            default:
                cause.description = "Unclassified failure: " + failure.message;
                break;
        }
        return cause;
    }
};

class FailurePreventionSystem {
private:
    std::vector<SynthesisFailure> failureHistory_;
    std::map<FailureType, std::vector<RootCause>> rootCauseRegistry_;
    std::vector<PreventiveMeasure> preventiveMeasures_;
    mutable std::mutex mutex_;
    RootCauseAnalyzer analyzer_;

public:
    FailurePreventionSystem() {
        initializePreventiveMeasures();
    }

    void recordFailure(const SynthesisFailure& failure) {
        std::lock_guard<std::mutex> lock(mutex_);
        failureHistory_.push_back(failure);
        auto cause = analyzer_.analyze(failure);
        rootCauseRegistry_[failure.type].push_back(cause);
    }

    bool validateAtom(const AtomSpec& atom) {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& measure : preventiveMeasures_) {
            if (!measure.check(atom)) {
                return false;
            }
        }
        return true;
    }

    std::vector<RootCause> getRootCausesForType(FailureType type) const {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = rootCauseRegistry_.find(type);
        if (it != rootCauseRegistry_.end()) {
            return it->second;
        }
        return {};
    }

    void installCustomMeasure(const PreventiveMeasure& measure) {
        std::lock_guard<std::mutex> lock(mutex_);
        preventiveMeasures_.push_back(measure);
    }

private:
    void initializePreventiveMeasures() {
        preventiveMeasures_.push_back({
            "binding-check",
            "Ensure atom binding has valid language and target fields",
            [](const AtomSpec& atom) {
                return !atom.binding.language.empty() && !atom.binding.target.empty();
            }
        });

        preventiveMeasures_.push_back({
            "spec-completeness",
            "Ensure critical atoms have complete metadata",
            [](const AtomSpec& atom) {
                if (!atom.critical) return true;
                return !atom.id.empty() && !atom.description.empty() && !atom.title.empty();
            }
        });

        preventiveMeasures_.push_back({
            "type-safety",
            "Ensure atom type is one of the supported implementation types",
            [](const AtomSpec& atom) {
                static const std::vector<std::string> validTypes = {
                    "implementation", "validation", "orchestration", "integration"
                };
                return std::find(validTypes.begin(), validTypes.end(), atom.type) != validTypes.end();
            }
        });
    }
};

} // namespace factory
