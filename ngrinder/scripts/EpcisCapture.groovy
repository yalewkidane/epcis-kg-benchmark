/**
 * E1 – Simple push (EPCIS alone) / E5 – capture under subscription load.
 * One test = one POST /capture of a document (SYNC = true: POST /events with one event).
 *
 * Documents come from resources/documents.json if uploaded next to the script; otherwise a
 * minimal ObjectEvent with a unique identifier is generated per test, so the script runs
 * without any upload and never repeats an identifier.
 *
 * UNIQUE = true (default) rewrites the identifiers (SGTIN serial, SSCC) and the eventIDs of
 * the document for every test, so every capture stores new events about new objects, as in
 * production. UNIQUE = false replays the documents unchanged: the repository stores a new
 * copy of the same events on every test (the capture interface does not deduplicate).
 * Either way the repository grows by one document per test; reset it between repetitions.
 */
import static net.grinder.script.Grinder.grinder
import static org.junit.Assert.*
import static org.hamcrest.Matchers.*
import net.grinder.script.GTest
import net.grinder.scriptengine.groovy.junit.GrinderRunner
import net.grinder.scriptengine.groovy.junit.annotation.BeforeProcess
import net.grinder.scriptengine.groovy.junit.annotation.BeforeThread
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.ngrinder.http.HTTPRequest
import org.ngrinder.http.HTTPRequestControl
import org.ngrinder.http.HTTPResponse
import groovy.json.JsonSlurper
import groovy.json.JsonOutput

@RunWith(GrinderRunner)
class EpcisCapture {

    static final String EPCIS_URL = "http://localhost:7080/epcis/v2"
    static final boolean SYNC = false
    // true: every test captures a new document (unique identifiers and eventIDs) – see header
    static final boolean UNIQUE = true
    // Optional: URL of a documents.json to download instead of uploading resources/documents.json
    static final String DOCUMENTS_URL = ""

    public static GTest test
    public static HTTPRequest request
    public static Map<String, String> headers = [:]
    public static List documents = []
    // Distinguishes the identifiers of this run from those of earlier runs (epoch seconds)
    public static String runSalt = String.valueOf(System.currentTimeMillis().intdiv(1000))

    @BeforeProcess
    public static void beforeProcess() {
        HTTPRequestControl.setConnectionTimeout(30000)
        test = new GTest(1, SYNC ? "POST /events" : "POST /capture")
        request = new HTTPRequest()
        headers = ["Content-Type": "application/json", "Accept": "application/json",
                   "GS1-EPCIS-Version": "2.0.0", "GS1-EPCIS-Max": "2.0.0", "GS1-EPCIS-Min": "2.0.0",
                   "GS1-CBV-Version": "2.0.0", "GS1-CBV-Max": "2.0.0", "GS1-CBV-Min": "2.0.0"]
        File f = new File("./resources/documents.json")
        if (f.exists()) {
            documents = new JsonSlurper().parse(f)
        } else if (DOCUMENTS_URL) {
            request.setHeaders(headers)
            HTTPResponse r = request.GET(DOCUMENTS_URL)
            assertThat("GET " + DOCUMENTS_URL, r.statusCode, is(200))
            documents = new JsonSlurper().parseText(r.getBodyText())
        }
        if (documents) grinder.logger.info("loaded {} documents (UNIQUE={}, salt {})", documents.size(), UNIQUE, runSalt)
        else grinder.logger.warn("no documents.json: generating one ObjectEvent per test")
    }

    @BeforeThread
    public void beforeThread() {
        test.record(this, "test")
        grinder.statistics.delayReports = true
    }

    @Before
    public void before() {
        request.setHeaders(headers)
    }

    /** A minimal, valid EPCISDocument with a never-repeating identifier. */
    static Map syntheticDocument() {
        String serial = "NG-" + grinder.agentNumber + "-" + grinder.processNumber + "-" + grinder.threadNumber + "-" + grinder.runNumber + "-" + System.nanoTime()
        String now = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
                .format(java.time.ZonedDateTime.now(java.time.ZoneOffset.UTC))
        def event = [
            eventID: "urn:uuid:" + UUID.randomUUID().toString(),
            type: "ObjectEvent", action: "ADD", bizStep: "commissioning", disposition: "active",
            epcList: ["https://id.oliot.org/01/08800026940100/21/" + serial],
            eventTime: now, eventTimeZoneOffset: "+00:00",
            readPoint: [id: "https://id.oliot.org/414/0880002694001"],
            bizLocation: [id: "https://id.oliot.org/414/0880002694001"],
        ]
        return ["@context": ["https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld"],
                type: "EPCISDocument", schemaVersion: "2.0", creationDate: now,
                epcisBody: [eventList: [event]]]
    }

    /** Token that is unique per test within this run and differs between runs (digits only). */
    static String uniqueToken() {
        return runSalt + grinder.agentNumber + grinder.processNumber +
               String.format("%02d%06d", grinder.threadNumber, grinder.runNumber)
    }

    /**
     * Deep copy of the document with new identifiers: the serial of every SGTIN (…/21/serial)
     * and every SSCC (…/00/digits) gets the token appended, every eventID becomes a new UUID.
     * Locations (…/414/…) and class-level identifiers stay as they are.
     */
    static Object uniquify(Object node, String token) {
        if (node instanceof Map) {
            def copy = [:]
            node.each { k, v -> copy[k] = (k == "eventID") ? "urn:uuid:" + UUID.randomUUID().toString() : uniquify(v, token) }
            return copy
        }
        if (node instanceof List) return node.collect { uniquify(it, token) }
        if (node instanceof String) {
            if (node.contains("/21/")) return node + "-" + token
            if (node.contains("/00/")) return node + token
        }
        return node
    }

    @Test
    public void test() {
        def doc
        if (documents) {
            doc = documents[(grinder.threadNumber * 100003 + grinder.runNumber) % documents.size()]
            if (UNIQUE) doc = uniquify(doc, uniqueToken())
        } else {
            doc = syntheticDocument()
        }
        HTTPResponse response
        if (SYNC) {
            response = request.POST(EPCIS_URL + "/events", JsonOutput.toJson(doc.epcisBody.eventList[0]).bytes)
        } else {
            response = request.POST(EPCIS_URL + "/capture", JsonOutput.toJson(doc).bytes)
        }
        if (response.statusCode >= 300) {
            grinder.logger.warn("capture failed: {} {}", response.statusCode, response.getBodyText()?.take(200))
        }
        assertThat(response.statusCode, allOf(greaterThanOrEqualTo(200), lessThan(300)))
    }
}
